using System.Text.Json;
using Scada.Api.Domain;

namespace Scada.Api.Services;

public interface IDeviceSessionClient : IAsyncDisposable
{
    event EventHandler<DeviceValueChange>? ValueChanged;

    event EventHandler<DeviceConnectionStateChanged>? ConnectionStateChanged;

    DeviceConnectionState State { get; }

    Task ConnectAsync(DeviceConnectionOptions options, CancellationToken cancellationToken);

    Task DisconnectAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<DeviceBrowseNode>> BrowseAsync(string? nodeId, CancellationToken cancellationToken);

    Task ApplySubscriptionsAsync(IReadOnlyCollection<DeviceSubscriptionDefinition> subscriptions, CancellationToken cancellationToken);

    Task<DeviceWriteResult> WriteAsync(DeviceWriteRequest request, CancellationToken cancellationToken);
}

public interface IDeviceSessionClientFactory
{
    IDeviceSessionClient Create(DeviceDriverKind driverKind);
}

public enum DeviceConnectionState
{
    Disconnected = 0,
    Connecting = 1,
    Connected = 2,
    Reconnecting = 3,
    Faulted = 4
}

public sealed record DeviceConnectionOptions(
    Guid DeviceId,
    string DeviceName,
    DeviceDriverKind DriverKind,
    string EndpointUrl,
    string SecurityMode,
    string SecurityPolicy,
    DeviceAuthenticationMode AuthenticationMode,
    string? Username,
    string? Password);

public enum DeviceAuthenticationMode
{
    Anonymous = 0,
    UsernamePassword = 1
}

public sealed record DeviceSubscriptionDefinition(
    Guid TagId,
    string NodeId,
    string DisplayName,
    string DataType,
    double SamplingIntervalMs,
    double PublishingIntervalMs);

public sealed record DeviceBrowseNode(
    string NodeId,
    string BrowseName,
    string DisplayName,
    string NodeClass,
    bool HasChildren,
    string? DataType,
    bool Writable);

public sealed record DeviceValueChange(
    Guid DeviceId,
    Guid TagId,
    object? Value,
    string Quality,
    DateTimeOffset? SourceTimestamp,
    DateTimeOffset? ServerTimestamp);

public sealed record DeviceConnectionStateChanged(
    Guid DeviceId,
    DeviceConnectionState State,
    string Message);

public sealed record DeviceWriteRequest(
    Guid TagId,
    string NodeId,
    string DataType,
    JsonElement Value);

public sealed record DeviceWriteResult(
    Guid TagId,
    bool Succeeded,
    string StatusCode,
    string? ErrorMessage);
