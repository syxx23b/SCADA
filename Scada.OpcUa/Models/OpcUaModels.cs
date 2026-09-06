using System.Text.Json;

namespace Scada.OpcUa.Models;

public enum OpcUaAuthenticationMode
{
    Anonymous = 0,
    UsernamePassword = 1
}

public enum OpcUaConnectionState
{
    Disconnected = 0,
    Connecting = 1,
    Connected = 2,
    Reconnecting = 3,
    Faulted = 4
}

public sealed record OpcUaConnectionOptions(
    Guid DeviceId,
    string DeviceName,
    string EndpointUrl,
    string SecurityMode,
    string SecurityPolicy,
    OpcUaAuthenticationMode AuthenticationMode,
    string? Username,
    string? Password,
    bool AutoAcceptUntrustedCertificates = true);

public sealed record OpcUaBrowseNode(
    string NodeId,
    string BrowseName,
    string DisplayName,
    string NodeClass,
    bool HasChildren,
    string? DataType,
    bool Writable);

public sealed record OpcUaSubscriptionDefinition(
    Guid TagId,
    string NodeId,
    string DisplayName,
    string DataType,
    double SamplingIntervalMs,
    double PublishingIntervalMs);

public sealed record OpcUaValueChange(
    Guid DeviceId,
    Guid TagId,
    object? Value,
    string Quality,
    DateTimeOffset? SourceTimestamp,
    DateTimeOffset? ServerTimestamp);

public sealed record OpcUaConnectionStateChanged(
    Guid DeviceId,
    OpcUaConnectionState State,
    string Message,
    DateTimeOffset OccurredAt);

public sealed record OpcUaWriteRequest(
    Guid TagId,
    string NodeId,
    string DataType,
    JsonElement Value);

public sealed record OpcUaWriteResult(
    Guid TagId,
    bool Succeeded,
    string StatusCode,
    string? ErrorMessage);
