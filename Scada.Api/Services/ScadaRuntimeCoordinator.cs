using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;
using Scada.OpcUa.Abstractions;
using Scada.OpcUa.Models;

namespace Scada.Api.Services;

public interface IScadaRuntimeCoordinator
{
    TagSnapshotDto? GetSnapshot(Guid tagId);

    bool IsConnectionHealthy(Guid deviceId);

    Task ConnectAsync(DeviceConnectionEntity device, IReadOnlyCollection<TagDefinitionEntity> tags, CancellationToken cancellationToken);

    Task DisconnectAsync(Guid deviceId, CancellationToken cancellationToken);

    Task<IReadOnlyList<BrowseNodeDto>> BrowseAsync(DeviceConnectionEntity device, string? nodeId, CancellationToken cancellationToken);

    Task RefreshSubscriptionsAsync(DeviceConnectionEntity device, IReadOnlyCollection<TagDefinitionEntity> tags, CancellationToken cancellationToken);

    Task<OpcUaWriteResult> WriteAsync(DeviceConnectionEntity device, TagDefinitionEntity tag, JsonElement value, CancellationToken cancellationToken);

    Task<RuntimeOverviewDto> GetRuntimeOverviewAsync(CancellationToken cancellationToken);
}

public sealed class ScadaRuntimeCoordinator : IScadaRuntimeCoordinator
{
    private readonly IOpcUaSessionClientFactory _clientFactory;
    private readonly IServiceScopeFactory _scopeFactory;
    private readonly TagSnapshotCache _snapshotCache;
    private readonly RealtimeNotifier _realtimeNotifier;
    private readonly ILogger<ScadaRuntimeCoordinator> _logger;
    private readonly ConcurrentDictionary<Guid, DeviceRuntimeContext> _contexts = new();

    public ScadaRuntimeCoordinator(
        IOpcUaSessionClientFactory clientFactory,
        IServiceScopeFactory scopeFactory,
        TagSnapshotCache snapshotCache,
        RealtimeNotifier realtimeNotifier,
        ILogger<ScadaRuntimeCoordinator> logger)
    {
        _clientFactory = clientFactory;
        _scopeFactory = scopeFactory;
        _snapshotCache = snapshotCache;
        _realtimeNotifier = realtimeNotifier;
        _logger = logger;
    }

    public TagSnapshotDto? GetSnapshot(Guid tagId)
    {
        return _snapshotCache.Get(tagId);
    }

    public bool IsConnectionHealthy(Guid deviceId)
    {
        return _contexts.TryGetValue(deviceId, out var context) &&
               context.Client.State is OpcUaConnectionState.Connected or OpcUaConnectionState.Connecting or OpcUaConnectionState.Reconnecting;
    }

    public async Task ConnectAsync(DeviceConnectionEntity device, IReadOnlyCollection<TagDefinitionEntity> tags, CancellationToken cancellationToken)
    {
        if (_contexts.TryGetValue(device.Id, out var existingContext) &&
            existingContext.Client.State is OpcUaConnectionState.Connected or OpcUaConnectionState.Connecting or OpcUaConnectionState.Reconnecting)
        {
            await existingContext.Client.ApplySubscriptionsAsync(ToSubscriptions(tags), cancellationToken);
            return;
        }

        if (_contexts.TryRemove(device.Id, out var previousContext))
        {
            previousContext.Client.ValueChanged -= OnValueChanged;
            previousContext.Client.ConnectionStateChanged -= OnConnectionStateChanged;
            await previousContext.Client.DisposeAsync();
        }

        var client = _clientFactory.Create();
        client.ValueChanged += OnValueChanged;
        client.ConnectionStateChanged += OnConnectionStateChanged;

        try
        {
            await client.ConnectAsync(ToConnectionOptions(device), cancellationToken);
            await client.ApplySubscriptionsAsync(ToSubscriptions(tags), cancellationToken);
            _contexts[device.Id] = new DeviceRuntimeContext(device.Id, device.Name, client);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            await client.DisposeAsync();
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Failed to connect device {DeviceName}.", device.Name);
            await client.DisposeAsync();
            await PersistDeviceStateAsync(device.Id, DeviceConnectionStatus.Faulted, exception.Message, CancellationToken.None);
            throw;
        }
    }

    public async Task DisconnectAsync(Guid deviceId, CancellationToken cancellationToken)
    {
        if (_contexts.TryRemove(deviceId, out var context))
        {
            context.Client.ValueChanged -= OnValueChanged;
            context.Client.ConnectionStateChanged -= OnConnectionStateChanged;
            await context.Client.DisconnectAsync(cancellationToken);
            await context.Client.DisposeAsync();
        }

        await PersistDeviceStateAsync(deviceId, DeviceConnectionStatus.Disconnected, "Disconnected by operator.", cancellationToken);
    }

    public async Task<IReadOnlyList<BrowseNodeDto>> BrowseAsync(DeviceConnectionEntity device, string? nodeId, CancellationToken cancellationToken)
    {
        var context = await EnsureContextAsync(device, cancellationToken);
        var nodes = await context.Client.BrowseAsync(nodeId, cancellationToken);
        return nodes.Select(node => new BrowseNodeDto(
                node.NodeId,
                node.BrowseName,
                node.DisplayName,
                node.NodeClass,
                node.HasChildren,
                node.DataType,
                node.Writable))
            .ToArray();
    }

    public async Task RefreshSubscriptionsAsync(DeviceConnectionEntity device, IReadOnlyCollection<TagDefinitionEntity> tags, CancellationToken cancellationToken)
    {
        if (!_contexts.TryGetValue(device.Id, out var context))
        {
            return;
        }

        await context.Client.ApplySubscriptionsAsync(ToSubscriptions(tags), cancellationToken);
    }

    public async Task<OpcUaWriteResult> WriteAsync(DeviceConnectionEntity device, TagDefinitionEntity tag, JsonElement value, CancellationToken cancellationToken)
    {
        var context = await EnsureContextAsync(device, cancellationToken);
        return await context.Client.WriteAsync(new OpcUaWriteRequest(tag.Id, tag.NodeId, tag.DataType, value), cancellationToken);
    }

    public async Task<RuntimeOverviewDto> GetRuntimeOverviewAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();

        var devices = await dbContext.Devices
            .Include(item => item.Tags)
            .OrderBy(item => item.Name)
            .ToListAsync(cancellationToken);

        var tags = devices.SelectMany(item => item.Tags).OrderBy(item => item.DisplayName).ToArray();
        var snapshots = _snapshotCache.GetAll();

        return new RuntimeOverviewDto(
            devices.Select(device => new DeviceRuntimeDto(
                    device.Id,
                    device.Name,
                    device.Status.ToString(),
                    device.EndpointUrl,
                    device.Tags.Count(tag => tag.Enabled),
                    device.Tags.Count(tag => tag.Enabled && tag.AllowWrite)))
                .ToArray(),
            tags.Select(tag => tag.ToDto()).ToArray(),
            snapshots);
    }

    private async Task<DeviceRuntimeContext> EnsureContextAsync(DeviceConnectionEntity device, CancellationToken cancellationToken)
    {
        if (_contexts.TryGetValue(device.Id, out var existing))
        {
            return existing;
        }

        await using var scope = _scopeFactory.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
        var tags = await dbContext.Tags
            .Where(item => item.DeviceId == device.Id && item.Enabled)
            .ToListAsync(cancellationToken);

        await ConnectAsync(device, tags, cancellationToken);
        return _contexts[device.Id];
    }

    private static IReadOnlyCollection<OpcUaSubscriptionDefinition> ToSubscriptions(IEnumerable<TagDefinitionEntity> tags)
    {
        return tags.Where(item => item.Enabled)
            .Select(item => new OpcUaSubscriptionDefinition(
                item.Id,
                item.NodeId,
                item.DisplayName,
                item.DataType,
                item.SamplingIntervalMs,
                item.PublishingIntervalMs))
            .ToArray();
    }

    private static OpcUaConnectionOptions ToConnectionOptions(DeviceConnectionEntity device)
    {
        return new OpcUaConnectionOptions(
            device.Id,
            device.Name,
            device.EndpointUrl,
            device.SecurityMode,
            device.SecurityPolicy,
            device.AuthMode.Equals("UsernamePassword", StringComparison.OrdinalIgnoreCase)
                ? OpcUaAuthenticationMode.UsernamePassword
                : OpcUaAuthenticationMode.Anonymous,
            device.Username,
            device.Password);
    }

    private void OnValueChanged(object? sender, OpcUaValueChange eventArgs)
    {
        var connectionState = _contexts.TryGetValue(eventArgs.DeviceId, out var context)
            ? context.Client.State.ToString()
            : DeviceConnectionStatus.Disconnected.ToString();

        var snapshot = new TagSnapshotDto(
            eventArgs.TagId,
            eventArgs.DeviceId,
            eventArgs.Value,
            eventArgs.Quality,
            eventArgs.SourceTimestamp,
            eventArgs.ServerTimestamp,
            connectionState);

        _snapshotCache.Upsert(snapshot);
        _ = _realtimeNotifier.PublishSnapshotAsync(snapshot, CancellationToken.None);
    }

    private void OnConnectionStateChanged(object? sender, OpcUaConnectionStateChanged eventArgs)
    {
        _ = PersistDeviceStateAsync(eventArgs.DeviceId, MapState(eventArgs.State), eventArgs.Message, CancellationToken.None);
    }

    private async Task PersistDeviceStateAsync(Guid deviceId, DeviceConnectionStatus status, string message, CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
        var device = await dbContext.Devices.FirstOrDefaultAsync(item => item.Id == deviceId, cancellationToken);

        if (device is not null)
        {
            device.Status = status;
            device.UpdatedAt = DateTimeOffset.UtcNow;
            await dbContext.SaveChangesAsync(cancellationToken);
        }

        await _realtimeNotifier.PublishDeviceStatusAsync(
            new DeviceStatusChangedDto(deviceId, status.ToString(), message, DateTimeOffset.UtcNow),
            cancellationToken);
    }

    private static DeviceConnectionStatus MapState(OpcUaConnectionState state)
    {
        return state switch
        {
            OpcUaConnectionState.Connecting => DeviceConnectionStatus.Connecting,
            OpcUaConnectionState.Connected => DeviceConnectionStatus.Connected,
            OpcUaConnectionState.Reconnecting => DeviceConnectionStatus.Reconnecting,
            OpcUaConnectionState.Faulted => DeviceConnectionStatus.Faulted,
            _ => DeviceConnectionStatus.Disconnected
        };
    }

    private sealed record DeviceRuntimeContext(Guid DeviceId, string DeviceName, IOpcUaSessionClient Client);
}
