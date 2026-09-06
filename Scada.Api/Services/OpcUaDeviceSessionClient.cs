using Scada.OpcUa.Abstractions;
using Scada.OpcUa.Models;

namespace Scada.Api.Services;

public sealed class OpcUaDeviceSessionClient : IDeviceSessionClient
{
    private readonly IOpcUaSessionClient _inner;

    public OpcUaDeviceSessionClient(IOpcUaSessionClient inner)
    {
        _inner = inner;
        _inner.ValueChanged += OnValueChanged;
        _inner.ConnectionStateChanged += OnConnectionStateChanged;
    }

    public event EventHandler<DeviceValueChange>? ValueChanged;

    public event EventHandler<DeviceConnectionStateChanged>? ConnectionStateChanged;

    public DeviceConnectionState State => _inner.State switch
    {
        OpcUaConnectionState.Connecting => DeviceConnectionState.Connecting,
        OpcUaConnectionState.Connected => DeviceConnectionState.Connected,
        OpcUaConnectionState.Reconnecting => DeviceConnectionState.Reconnecting,
        OpcUaConnectionState.Faulted => DeviceConnectionState.Faulted,
        _ => DeviceConnectionState.Disconnected
    };

    public Task ConnectAsync(DeviceConnectionOptions options, CancellationToken cancellationToken)
    {
        return _inner.ConnectAsync(new OpcUaConnectionOptions(
            options.DeviceId,
            options.DeviceName,
            options.EndpointUrl,
            options.SecurityMode,
            options.SecurityPolicy,
            options.AuthenticationMode == DeviceAuthenticationMode.UsernamePassword
                ? OpcUaAuthenticationMode.UsernamePassword
                : OpcUaAuthenticationMode.Anonymous,
            options.Username,
            options.Password), cancellationToken);
    }

    public Task DisconnectAsync(CancellationToken cancellationToken)
    {
        return _inner.DisconnectAsync(cancellationToken);
    }

    public async Task<IReadOnlyList<DeviceBrowseNode>> BrowseAsync(string? nodeId, CancellationToken cancellationToken)
    {
        var nodes = await _inner.BrowseAsync(nodeId, cancellationToken);
        return nodes.Select(node => new DeviceBrowseNode(
                node.NodeId,
                node.BrowseName,
                node.DisplayName,
                node.NodeClass,
                node.HasChildren,
                node.DataType,
                node.Writable))
            .ToArray();
    }

    public Task ApplySubscriptionsAsync(IReadOnlyCollection<DeviceSubscriptionDefinition> subscriptions, CancellationToken cancellationToken)
    {
        return _inner.ApplySubscriptionsAsync(
            subscriptions.Select(item => new OpcUaSubscriptionDefinition(
                    item.TagId,
                    item.NodeId,
                    item.DisplayName,
                    item.DataType,
                    item.SamplingIntervalMs,
                    item.PublishingIntervalMs))
                .ToArray(),
            cancellationToken);
    }

    public async Task<DeviceWriteResult> WriteAsync(DeviceWriteRequest request, CancellationToken cancellationToken)
    {
        var result = await _inner.WriteAsync(new OpcUaWriteRequest(request.TagId, request.NodeId, request.DataType, request.Value), cancellationToken);
        return new DeviceWriteResult(result.TagId, result.Succeeded, result.StatusCode, result.ErrorMessage);
    }

    public async ValueTask DisposeAsync()
    {
        _inner.ValueChanged -= OnValueChanged;
        _inner.ConnectionStateChanged -= OnConnectionStateChanged;
        await _inner.DisposeAsync();
    }

    private void OnValueChanged(object? sender, OpcUaValueChange eventArgs)
    {
        ValueChanged?.Invoke(this, new DeviceValueChange(
            eventArgs.DeviceId,
            eventArgs.TagId,
            eventArgs.Value,
            eventArgs.Quality,
            eventArgs.SourceTimestamp,
            eventArgs.ServerTimestamp));
    }

    private void OnConnectionStateChanged(object? sender, OpcUaConnectionStateChanged eventArgs)
    {
        ConnectionStateChanged?.Invoke(this, new DeviceConnectionStateChanged(
            eventArgs.DeviceId,
            State,
            eventArgs.Message));
    }
}
