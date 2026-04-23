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
}
