using Scada.OpcUa.Models;

namespace Scada.OpcUa.Abstractions;

public interface IOpcUaSessionClient : IAsyncDisposable
{
    event EventHandler<OpcUaValueChange>? ValueChanged;
    event EventHandler<OpcUaConnectionStateChanged>? ConnectionStateChanged;

    OpcUaConnectionState State { get; }

    Task ConnectAsync(OpcUaConnectionOptions options, CancellationToken cancellationToken);

    Task DisconnectAsync(CancellationToken cancellationToken);

    Task<IReadOnlyList<OpcUaBrowseNode>> BrowseAsync(string? nodeId, CancellationToken cancellationToken);

    Task ApplySubscriptionsAsync(IReadOnlyCollection<OpcUaSubscriptionDefinition> subscriptions, CancellationToken cancellationToken);

    Task<OpcUaWriteResult> WriteAsync(OpcUaWriteRequest request, CancellationToken cancellationToken);
}
