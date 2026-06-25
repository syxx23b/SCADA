using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;
using Scada.Api.Services;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/devices")]
public sealed class DevicesController : ControllerBase
{
    private readonly ScadaDbContext _dbContext;
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;

    public DevicesController(ScadaDbContext dbContext, IScadaRuntimeCoordinator runtimeCoordinator)
    {
        _dbContext = dbContext;
        _runtimeCoordinator = runtimeCoordinator;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<DeviceConnectionDto>>> GetDevices(CancellationToken cancellationToken)
    {
        var devices = await _dbContext.Devices
            .OrderBy(item => item.Name)
            .ToListAsync(cancellationToken);

        return Ok(devices.Select(item => item.ToDto()).ToArray());
    }

    [HttpPost]
    public async Task<ActionResult<DeviceConnectionDto>> CreateDevice([FromBody] UpsertDeviceRequest request, CancellationToken cancellationToken)
    {
        var sanitized = ScadaInputSanitizer.NormalizeDevice(request);
        var entity = new DeviceConnectionEntity
        {
            Name = sanitized.Name,
            DriverKind = sanitized.DriverKind,
            EndpointUrl = sanitized.EndpointUrl,
            SecurityMode = sanitized.SecurityMode,
            SecurityPolicy = sanitized.SecurityPolicy,
            AuthMode = sanitized.AuthMode,
            Username = sanitized.Username,
            Password = sanitized.Password,
            AutoConnect = sanitized.AutoConnect
        };

        _dbContext.Devices.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return CreatedAtAction(nameof(GetDevices), new { id = entity.Id }, entity.ToDto());
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<DeviceConnectionDto>> UpdateDevice(Guid id, [FromBody] UpsertDeviceRequest request, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Devices
            .Include(item => item.Tags)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (entity is null)
        {
            return NotFound();
        }

        var sanitized = ScadaInputSanitizer.NormalizeDevice(request);
        entity.Name = sanitized.Name;
        entity.DriverKind = sanitized.DriverKind;
        entity.EndpointUrl = sanitized.EndpointUrl;
        entity.SecurityMode = sanitized.SecurityMode;
        entity.SecurityPolicy = sanitized.SecurityPolicy;
        entity.AuthMode = sanitized.AuthMode;
        entity.Username = sanitized.Username;
        entity.Password = sanitized.Password;
        entity.AutoConnect = sanitized.AutoConnect;
        entity.UpdatedAt = DateTimeOffset.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        if (entity.Status is DeviceConnectionStatus.Connected or DeviceConnectionStatus.Reconnecting)
        {
            await _runtimeCoordinator.ConnectAsync(entity, entity.Tags.Where(tag => tag.Enabled).ToArray(), cancellationToken);
        }

        return Ok(entity.ToDto());
    }

    [HttpPost("{id:guid}/connect")]
    public async Task<ActionResult<DeviceConnectionDto>> Connect(Guid id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Devices
            .Include(item => item.Tags)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (entity is null)
        {
            return NotFound();
        }

        await _runtimeCoordinator.ConnectAsync(entity, entity.Tags.Where(tag => tag.Enabled).ToArray(), cancellationToken);
        return Ok(entity.ToDto());
    }

    [HttpPost("{id:guid}/disconnect")]
    public async Task<ActionResult<DeviceConnectionDto>> Disconnect(Guid id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Devices.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        await _runtimeCoordinator.DisconnectAsync(id, cancellationToken);
        entity.Status = DeviceConnectionStatus.Disconnected;
        entity.UpdatedAt = DateTimeOffset.UtcNow;
        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(entity.ToDto());
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteDevice(Guid id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Devices
            .Include(item => item.Tags)
            .FirstOrDefaultAsync(item => item.Id == id, cancellationToken);

        if (entity is null)
        {
            return NotFound();
        }

        if (string.Equals(entity.Name, "Local", StringComparison.OrdinalIgnoreCase))
        {
            return BadRequest("Local 设备不能删除。");
        }

        var localDevice = await EnsureLocalDeviceAsync(cancellationToken);
        var localTags = entity.Tags.Where(IsLocalStaticTag).ToList();
        foreach (var tag in localTags)
        {
            tag.DeviceId = localDevice.Id;
            tag.UpdatedAt = DateTimeOffset.UtcNow;
        }

        if (localTags.Count > 0)
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        await _runtimeCoordinator.DisconnectAsync(id, cancellationToken);
        _dbContext.Devices.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return NoContent();
    }

    [HttpGet("{id:guid}/browse")]
    public async Task<ActionResult<IReadOnlyList<BrowseNodeDto>>> Browse(Guid id, [FromQuery] string? nodeId, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Devices.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var nodes = await _runtimeCoordinator.BrowseAsync(entity, nodeId, cancellationToken);
        return Ok(nodes);
    }

    private async Task<DeviceConnectionEntity> EnsureLocalDeviceAsync(CancellationToken cancellationToken)
    {
        var localDevice = await _dbContext.Devices.FirstOrDefaultAsync(item => item.Name == "Local", cancellationToken);
        if (localDevice is not null)
        {
            return localDevice;
        }

        localDevice = new DeviceConnectionEntity
        {
            Name = "Local",
            DriverKind = DeviceDriverKind.Local,
            EndpointUrl = "local://static",
            SecurityMode = "None",
            SecurityPolicy = "None",
            AuthMode = "Anonymous",
            AutoConnect = false,
            Status = DeviceConnectionStatus.Disconnected
        };

        _dbContext.Devices.Add(localDevice);
        await _dbContext.SaveChangesAsync(cancellationToken);
        return localDevice;
    }

    private static bool IsLocalStaticTag(TagDefinitionEntity tag)
    {
        if (string.IsNullOrWhiteSpace(tag.GroupKey))
        {
            return false;
        }

        var normalized = tag.GroupKey.Trim();
        return normalized.Equals("Local", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Local Variable", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Device1_LocalVariable", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Local.RecipeDJ", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Local.RecipeQYJ", StringComparison.OrdinalIgnoreCase);
    }
}
