using Scada.Api.Domain;

namespace Scada.Api.Services;

public sealed class LocalDeviceSessionClient : IDeviceSessionClient
{
    public event EventHandler<DeviceValueChange>? ValueChanged;

    public event EventHandler<DeviceConnectionStateChanged>? ConnectionStateChanged;

    public DeviceConnectionState State { get; private set; } = DeviceConnectionState.Disconnected;

    public Task ConnectAsync(DeviceConnectionOptions options, CancellationToken cancellationToken)
    {
        State = DeviceConnectionState.Connected;
        ConnectionStateChanged?.Invoke(this, new DeviceConnectionStateChanged(options.DeviceId, State, "Local device is always available."));
        return Task.CompletedTask;
    }

    public Task DisconnectAsync(CancellationToken cancellationToken)
    {
        State = DeviceConnectionState.Disconnected;
        return Task.CompletedTask;
    }

    public Task<IReadOnlyList<DeviceBrowseNode>> BrowseAsync(string? nodeId, CancellationToken cancellationToken)
    {
        return Task.FromResult<IReadOnlyList<DeviceBrowseNode>>(Array.Empty<DeviceBrowseNode>());
    }

    public Task ApplySubscriptionsAsync(IReadOnlyCollection<DeviceSubscriptionDefinition> subscriptions, CancellationToken cancellationToken)
    {
        return Task.CompletedTask;
    }

    public Task<DeviceWriteResult> WriteAsync(DeviceWriteRequest request, CancellationToken cancellationToken)
    {
        return Task.FromResult(new DeviceWriteResult(request.TagId, true, "Good", null));
    }

    public ValueTask DisposeAsync()
    {
        return ValueTask.CompletedTask;
    }
}
