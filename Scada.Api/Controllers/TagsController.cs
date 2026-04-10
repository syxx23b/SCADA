using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;
using Scada.Api.Services;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/tags")]
public sealed class TagsController : ControllerBase
{
    private readonly ScadaDbContext _dbContext;
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;
    private readonly ISingleTagWriteCoordinator _singleTagWriteCoordinator;
    private readonly TagSnapshotCache _tagSnapshotCache;

    public TagsController(
        ScadaDbContext dbContext,
        IScadaRuntimeCoordinator runtimeCoordinator,
        ISingleTagWriteCoordinator singleTagWriteCoordinator,
        TagSnapshotCache tagSnapshotCache)
    {
        _dbContext = dbContext;
        _runtimeCoordinator = runtimeCoordinator;
        _singleTagWriteCoordinator = singleTagWriteCoordinator;
        _tagSnapshotCache = tagSnapshotCache;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<TagDefinitionDto>>> GetTags([FromQuery] Guid? deviceId, CancellationToken cancellationToken)
    {
        var query = _dbContext.Tags.AsQueryable();
        if (deviceId.HasValue)
        {
            query = query.Where(item => item.DeviceId == deviceId.Value);
        }

        var tags = await query.OrderBy(item => item.DisplayName).ToListAsync(cancellationToken);
        return Ok(tags.Select(item => item.ToDto()).ToArray());
    }

    [HttpPost]
    public async Task<ActionResult<TagDefinitionDto>> CreateTag([FromBody] UpsertTagRequest request, CancellationToken cancellationToken)
    {
        var sanitized = ScadaInputSanitizer.NormalizeTag(request);
        var device = await _dbContext.Devices.FirstOrDefaultAsync(item => item.Id == sanitized.DeviceId, cancellationToken);

        if (device is null)
        {
            return NotFound("Device was not found.");
        }

        var entity = new TagDefinitionEntity
        {
            DeviceId = sanitized.DeviceId,
            NodeId = sanitized.NodeId,
            BrowseName = sanitized.BrowseName,
            DisplayName = sanitized.DisplayName,
            DataType = sanitized.DataType,
            SamplingIntervalMs = sanitized.SamplingIntervalMs,
            PublishingIntervalMs = sanitized.PublishingIntervalMs,
            AllowWrite = sanitized.AllowWrite,
            Enabled = sanitized.Enabled,
            GroupKey = sanitized.GroupKey
        };

        _dbContext.Tags.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var deviceTags = await _dbContext.Tags.Where(item => item.DeviceId == sanitized.DeviceId && item.Enabled).ToListAsync(cancellationToken);
        await _runtimeCoordinator.RefreshSubscriptionsAsync(device, deviceTags, cancellationToken);

        return CreatedAtAction(nameof(GetTags), new { id = entity.Id }, entity.ToDto());
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<TagDefinitionDto>> UpdateTag(Guid id, [FromBody] UpsertTagRequest request, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Tags.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var sanitized = ScadaInputSanitizer.NormalizeTag(request);
        entity.NodeId = sanitized.NodeId;
        entity.BrowseName = sanitized.BrowseName;
        entity.DisplayName = sanitized.DisplayName;
        entity.DataType = sanitized.DataType;
        entity.SamplingIntervalMs = sanitized.SamplingIntervalMs;
        entity.PublishingIntervalMs = sanitized.PublishingIntervalMs;
        entity.AllowWrite = sanitized.AllowWrite;
        entity.Enabled = sanitized.Enabled;
        entity.GroupKey = sanitized.GroupKey;
        entity.UpdatedAt = DateTimeOffset.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        var device = await _dbContext.Devices.FirstAsync(item => item.Id == entity.DeviceId, cancellationToken);
        var deviceTags = await _dbContext.Tags.Where(item => item.DeviceId == entity.DeviceId && item.Enabled).ToListAsync(cancellationToken);
        await _runtimeCoordinator.RefreshSubscriptionsAsync(device, deviceTags, cancellationToken);

        return Ok(entity.ToDto());
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteTag(Guid id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Tags.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var device = await _dbContext.Devices.FirstAsync(item => item.Id == entity.DeviceId, cancellationToken);
        var deviceId = entity.DeviceId;
        var tagId = entity.Id;

        _dbContext.Tags.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var deviceTags = await _dbContext.Tags.Where(item => item.DeviceId == deviceId && item.Enabled).ToListAsync(cancellationToken);
        await _runtimeCoordinator.RefreshSubscriptionsAsync(device, deviceTags, cancellationToken);
        _tagSnapshotCache.Remove(tagId);

        return NoContent();
    }

    [HttpPost("{id:guid}/write")]
    public async Task<ActionResult<WriteOperationResultDto>> WriteTag(Guid id, [FromBody] WriteTagValueRequest request, CancellationToken cancellationToken)
    {
        var tag = await _dbContext.Tags.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (tag is null)
        {
            return NotFound();
        }

        var device = await _dbContext.Devices.FirstAsync(item => item.Id == tag.DeviceId, cancellationToken);
        var result = await _singleTagWriteCoordinator.WriteAsync(device, tag, request, cancellationToken);
        return Ok(result);
    }
}
