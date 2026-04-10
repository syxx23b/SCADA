using System.Collections.Concurrent;
using System.Text.Json;
using Microsoft.Extensions.Logging;
using Opc.Ua;
using Opc.Ua.Client;
using Opc.Ua.Configuration;
using Scada.OpcUa.Abstractions;
using Scada.OpcUa.Models;

namespace Scada.OpcUa.Services;

public sealed class OpcUaSessionClient : IOpcUaSessionClient
{
    private readonly ILogger<OpcUaSessionClient> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly ConcurrentDictionary<double, Subscription> _subscriptions = new();
    private readonly ConcurrentDictionary<Guid, OpcUaSubscriptionDefinition> _subscriptionDefinitions = new();

    private ApplicationConfiguration? _configuration;
    private OpcUaConnectionOptions? _options;
    private Session? _session;
    private SessionReconnectHandler? _reconnectHandler;
    private bool _disposed;

    public OpcUaSessionClient(ILogger<OpcUaSessionClient> logger)
    {
        _logger = logger;
    }

    public event EventHandler<OpcUaValueChange>? ValueChanged;

    public event EventHandler<OpcUaConnectionStateChanged>? ConnectionStateChanged;

    public OpcUaConnectionState State { get; private set; } = OpcUaConnectionState.Disconnected;

    public async Task ConnectAsync(OpcUaConnectionOptions options, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            _options = options;
            await EnsureConnectedCoreAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task DisconnectAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            _reconnectHandler?.Dispose();
            _reconnectHandler = null;

            foreach (var subscription in _subscriptions.Values)
            {
                _session?.RemoveSubscription(subscription);
                subscription.Delete(true);
            }

            _subscriptions.Clear();
            _subscriptionDefinitions.Clear();

            if (_session is not null)
            {
                _session.KeepAlive -= SessionOnKeepAlive;
                await _session.CloseAsync(cancellationToken);
                _session.Dispose();
                _session = null;
            }

            UpdateState(OpcUaConnectionState.Disconnected, "Session disconnected.");
        }
        finally
        {
            _gate.Release();
        }
    }

    public async Task<IReadOnlyList<OpcUaBrowseNode>> BrowseAsync(string? nodeId, CancellationToken cancellationToken)
    {
        await EnsureReadyAsync(cancellationToken);

        var targetNodeId = string.IsNullOrWhiteSpace(nodeId)
            ? ObjectIds.ObjectsFolder
            : NodeId.Parse(nodeId);

        var nodes = new List<OpcUaBrowseNode>();
        var references = new ReferenceDescriptionCollection();
        byte[]? continuationPoint;

        _session!.Browse(
            null,
            null,
            targetNodeId,
            0u,
            BrowseDirection.Forward,
            ReferenceTypeIds.HierarchicalReferences,
            true,
            (uint)(NodeClass.Object | NodeClass.Variable),
            out continuationPoint,
            out references);

        foreach (var reference in references)
        {
            cancellationToken.ThrowIfCancellationRequested();

            var childNodeId = ExpandedNodeId.ToNodeId(reference.NodeId, _session.NamespaceUris);
            var variableNode = childNodeId is not null && reference.NodeClass == NodeClass.Variable
                ? _session.ReadNode(childNodeId) as VariableNode
                : null;

            var dataType = variableNode is not null
                ? FormatVariableDataType(variableNode)
                : null;

            var writable = variableNode is not null &&
                           (variableNode.UserAccessLevel & AccessLevels.CurrentWrite) == AccessLevels.CurrentWrite;

            var hasChildren = childNodeId is not null &&
                              (reference.NodeClass == NodeClass.Object || HasHierarchicalChildren(childNodeId));

            nodes.Add(new OpcUaBrowseNode(
                childNodeId?.ToString() ?? reference.NodeId.ToString(),
                reference.BrowseName.Name ?? reference.DisplayName.Text ?? reference.NodeId.ToString(),
                reference.DisplayName.Text ?? reference.BrowseName.Name ?? reference.NodeId.ToString(),
                reference.NodeClass.ToString(),
                hasChildren,
                dataType,
                writable));
        }

        return nodes
            .OrderByDescending(node => node.HasChildren)
            .ThenBy(node => node.DisplayName, StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    public async Task ApplySubscriptionsAsync(IReadOnlyCollection<OpcUaSubscriptionDefinition> subscriptions, CancellationToken cancellationToken)
    {
        await EnsureReadyAsync(cancellationToken);

        foreach (var definition in subscriptions)
        {
            _subscriptionDefinitions[definition.TagId] = definition;
        }

        var currentTagIds = subscriptions.Select(item => item.TagId).ToHashSet();
        foreach (var tagId in _subscriptionDefinitions.Keys)
        {
            if (!currentTagIds.Contains(tagId))
            {
                _subscriptionDefinitions.TryRemove(tagId, out _);
            }
        }

        var groups = subscriptions
            .GroupBy(item => Math.Max(100, item.PublishingIntervalMs))
            .ToDictionary(group => group.Key, group => group.ToArray());

        foreach (var key in _subscriptions.Keys.ToArray())
        {
            if (groups.ContainsKey(key))
            {
                continue;
            }

            if (_subscriptions.TryRemove(key, out var orphaned))
            {
                _session!.RemoveSubscription(orphaned);
                orphaned.Delete(true);
            }
        }

        foreach (var group in groups)
        {
            var subscription = _subscriptions.GetOrAdd(group.Key, publishingInterval =>
            {
                var created = new Subscription(_session!.DefaultSubscription)
                {
                    DisplayName = $"scada-{publishingInterval:0}",
                    PublishingEnabled = true,
                    PublishingInterval = (int)publishingInterval
                };

                _session.AddSubscription(created);
                created.Create();
                return created;
            });

            var existingItems = subscription.MonitoredItems.ToList();
            foreach (var item in existingItems)
            {
                item.Notification -= MonitoredItemOnNotification;
            }

            if (existingItems.Count > 0)
            {
                subscription.RemoveItems(existingItems);
            }

            foreach (var definition in group.Value)
            {
                cancellationToken.ThrowIfCancellationRequested();

                var monitoredItem = new MonitoredItem(subscription.DefaultItem)
                {
                    StartNodeId = NodeId.Parse(definition.NodeId),
                    AttributeId = Attributes.Value,
                    DisplayName = definition.DisplayName,
                    SamplingInterval = (int)Math.Max(100, definition.SamplingIntervalMs),
                    QueueSize = 1,
                    DiscardOldest = true,
                    Handle = definition
                };

                monitoredItem.Notification += MonitoredItemOnNotification;
                subscription.AddItem(monitoredItem);
            }

            subscription.ApplyChanges();
        }
    }

    public async Task<OpcUaWriteResult> WriteAsync(OpcUaWriteRequest request, CancellationToken cancellationToken)
    {
        await EnsureReadyAsync(cancellationToken);

        try
        {
            var writeValue = new WriteValue
            {
                NodeId = NodeId.Parse(request.NodeId),
                AttributeId = Attributes.Value,
                Value = new DataValue(new Variant(ConvertValue(request.Value, request.DataType)))
            };

            _session!.Write(
                null,
                new WriteValueCollection { writeValue },
                out var results,
                out _);

            var statusCode = results[0];
            return new OpcUaWriteResult(
                request.TagId,
                StatusCode.IsGood(statusCode),
                statusCode.ToString(),
                StatusCode.IsGood(statusCode) ? null : $"OPC UA write returned {statusCode}.");
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Failed to write OPC UA value for tag {TagId}.", request.TagId);
            return new OpcUaWriteResult(request.TagId, false, StatusCodes.BadUnexpectedError.ToString(), exception.Message);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        _disposed = true;
        await DisconnectAsync(CancellationToken.None);
        _gate.Dispose();
    }

    private async Task EnsureReadyAsync(CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            await EnsureConnectedCoreAsync(cancellationToken);
        }
        finally
        {
            _gate.Release();
        }
    }

    private async Task EnsureConnectedCoreAsync(CancellationToken cancellationToken)
    {
        if (_session is { Connected: true })
        {
            return;
        }

        if (_options is null)
        {
            throw new InvalidOperationException("Connection options are not available.");
        }

        UpdateState(OpcUaConnectionState.Connecting, $"Connecting to {_options.EndpointUrl}.");

        _configuration ??= await CreateConfigurationAsync(cancellationToken);

        var endpoint = await CoreClientUtils.SelectEndpointAsync(
            _configuration,
            _options.EndpointUrl,
            UseSecurity(_options),
            15000,
            cancellationToken);

        endpoint.SecurityMode = ParseSecurityMode(_options.SecurityMode);
        endpoint.SecurityPolicyUri = ParseSecurityPolicy(_options.SecurityPolicy);

        var configuredEndpoint = new ConfiguredEndpoint(null, endpoint, EndpointConfiguration.Create(_configuration));
        var session = await Session.Create(
            _configuration,
            configuredEndpoint,
            false,
            false,
            _options.DeviceName,
            60_000,
            CreateUserIdentity(_options),
            null,
            cancellationToken);

        session.KeepAlive += SessionOnKeepAlive;

        _session?.Dispose();
        _session = session;

        UpdateState(OpcUaConnectionState.Connected, $"Connected to {_options.EndpointUrl}.");
    }

    private async Task<ApplicationConfiguration> CreateConfigurationAsync(CancellationToken cancellationToken)
    {
        var pkiRoot = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Scada",
            "pki");

        var configuration = new ApplicationConfiguration
        {
            ApplicationName = "Scada.Api",
            ApplicationUri = $"urn:{Utils.GetHostName()}:Scada.Api",
            ApplicationType = ApplicationType.Client,
            SecurityConfiguration = new SecurityConfiguration
            {
                ApplicationCertificate = new CertificateIdentifier
                {
                    StoreType = CertificateStoreType.Directory,
                    StorePath = Path.Combine(pkiRoot, "own"),
                    SubjectName = "CN=Scada.Api"
                },
                TrustedPeerCertificates = new CertificateTrustList
                {
                    StoreType = CertificateStoreType.Directory,
                    StorePath = Path.Combine(pkiRoot, "trusted")
                },
                TrustedIssuerCertificates = new CertificateTrustList
                {
                    StoreType = CertificateStoreType.Directory,
                    StorePath = Path.Combine(pkiRoot, "issuer")
                },
                RejectedCertificateStore = new CertificateTrustList
                {
                    StoreType = CertificateStoreType.Directory,
                    StorePath = Path.Combine(pkiRoot, "rejected")
                },
                AutoAcceptUntrustedCertificates = _options?.AutoAcceptUntrustedCertificates ?? true,
                RejectSHA1SignedCertificates = false,
                MinimumCertificateKeySize = 1024
            },
            TransportConfigurations = new TransportConfigurationCollection(),
            TransportQuotas = new TransportQuotas
            {
                OperationTimeout = 15000
            },
            ClientConfiguration = new ClientConfiguration
            {
                DefaultSessionTimeout = 60_000
            }
        };

        await configuration.Validate(ApplicationType.Client);

        if (configuration.SecurityConfiguration.AutoAcceptUntrustedCertificates)
        {
            configuration.CertificateValidator.CertificateValidation += (_, eventArgs) => eventArgs.Accept = true;
        }

        var application = new ApplicationInstance
        {
            ApplicationName = configuration.ApplicationName,
            ApplicationType = ApplicationType.Client,
            ApplicationConfiguration = configuration
        };

        await application.CheckApplicationInstanceCertificatesAsync(false, 0, cancellationToken);

        return configuration;
    }

    private IUserIdentity CreateUserIdentity(OpcUaConnectionOptions options)
    {
        return options.AuthenticationMode == OpcUaAuthenticationMode.UsernamePassword
            ? new UserIdentity(options.Username ?? string.Empty, System.Text.Encoding.UTF8.GetBytes(options.Password ?? string.Empty))
            : new UserIdentity();
    }

    private static MessageSecurityMode ParseSecurityMode(string value)
    {
        return Enum.TryParse<MessageSecurityMode>(value, true, out var securityMode)
            ? securityMode
            : MessageSecurityMode.None;
    }

    private static string ParseSecurityPolicy(string value)
    {
        if (string.IsNullOrWhiteSpace(value) || value.Equals("None", StringComparison.OrdinalIgnoreCase))
        {
            return SecurityPolicies.None;
        }

        return value.StartsWith("http", StringComparison.OrdinalIgnoreCase)
            ? value
            : value switch
            {
                "Basic256Sha256" => SecurityPolicies.Basic256Sha256,
                "Aes128_Sha256_RsaOaep" => SecurityPolicies.Aes128_Sha256_RsaOaep,
                "Aes256_Sha256_RsaPss" => SecurityPolicies.Aes256_Sha256_RsaPss,
                _ => SecurityPolicies.None
            };
    }

    private static bool UseSecurity(OpcUaConnectionOptions options)
    {
        return !string.Equals(options.SecurityMode, "None", StringComparison.OrdinalIgnoreCase) &&
               !string.Equals(options.SecurityPolicy, "None", StringComparison.OrdinalIgnoreCase);
    }

    private void SessionOnKeepAlive(ISession session, KeepAliveEventArgs eventArgs)
    {
        if (ServiceResult.IsGood(eventArgs.Status) || _reconnectHandler is not null)
        {
            return;
        }

        UpdateState(OpcUaConnectionState.Reconnecting, $"Connection degraded: {eventArgs.Status}.");
        _reconnectHandler = new SessionReconnectHandler(true, 10_000);
        _reconnectHandler.BeginReconnect(session, 10_000, ClientReconnected);
    }

    private async void ClientReconnected(object? sender, EventArgs eventArgs)
    {
        try
        {
            if (_reconnectHandler?.Session is not Session restoredSession)
            {
                return;
            }

            _session = restoredSession;
            _session.KeepAlive -= SessionOnKeepAlive;
            _session.KeepAlive += SessionOnKeepAlive;

            _reconnectHandler.Dispose();
            _reconnectHandler = null;

            UpdateState(OpcUaConnectionState.Connected, "Session reconnected.");
            await ApplySubscriptionsAsync(_subscriptionDefinitions.Values.ToArray(), CancellationToken.None);
        }
        catch (Exception exception)
        {
            _logger.LogError(exception, "Failed to reapply OPC UA subscriptions after reconnect.");
            UpdateState(OpcUaConnectionState.Faulted, exception.Message);
        }
    }

    private void MonitoredItemOnNotification(MonitoredItem monitoredItem, MonitoredItemNotificationEventArgs eventArgs)
    {
        if (monitoredItem.Handle is not OpcUaSubscriptionDefinition definition)
        {
            return;
        }

        foreach (var value in monitoredItem.DequeueValues())
        {
            ValueChanged?.Invoke(this, new OpcUaValueChange(
                _options?.DeviceId ?? Guid.Empty,
                definition.TagId,
                value.Value,
                value.StatusCode.ToString(),
                value.SourceTimestamp == DateTime.MinValue ? null : new DateTimeOffset(value.SourceTimestamp),
                value.ServerTimestamp == DateTime.MinValue ? null : new DateTimeOffset(value.ServerTimestamp)));
        }
    }

    private void UpdateState(OpcUaConnectionState state, string message)
    {
        State = state;
        ConnectionStateChanged?.Invoke(this, new OpcUaConnectionStateChanged(
            _options?.DeviceId ?? Guid.Empty,
            state,
            message,
            DateTimeOffset.UtcNow));
    }

    private bool HasHierarchicalChildren(NodeId nodeId)
    {
        try
        {
            _session!.Browse(
                null,
                null,
                nodeId,
                0u,
                BrowseDirection.Forward,
                ReferenceTypeIds.HierarchicalReferences,
                true,
                (uint)(NodeClass.Object | NodeClass.Variable),
                out _,
                out var references);

            return references.Count > 0;
        }
        catch (Exception exception)
        {
            _logger.LogDebug(exception, "Failed to probe child nodes for {NodeId}.", nodeId);
            return false;
        }
    }

    private string FormatVariableDataType(VariableNode variableNode)
    {
        var builtInType = TypeInfo.GetBuiltInType(variableNode.DataType, _session!.TypeTree);
        var coreTypeName = builtInType == BuiltInType.ExtensionObject
            ? ReadDataTypeDisplayName(variableNode.DataType) ?? "ExtensionObject"
            : builtInType.ToString();

        return AppendArraySuffix(coreTypeName, variableNode.ValueRank, variableNode.ArrayDimensions);
    }

    private string? ReadDataTypeDisplayName(NodeId dataTypeId)
    {
        try
        {
            var dataTypeNode = _session!.ReadNode(dataTypeId);
            return dataTypeNode?.DisplayName?.Text
                   ?? dataTypeNode?.BrowseName?.Name
                   ?? dataTypeId.ToString();
        }
        catch (Exception exception)
        {
            _logger.LogDebug(exception, "Failed to read data type node {DataTypeId}.", dataTypeId);
            return dataTypeId.ToString();
        }
    }

    private static string AppendArraySuffix(string coreTypeName, int valueRank, IReadOnlyList<uint>? arrayDimensions)
    {
        if (valueRank < 0)
        {
            return coreTypeName;
        }

        if (arrayDimensions is { Count: > 0 })
        {
            var dimensions = string.Join(",", arrayDimensions.Select(item => item == 0 ? "*" : item.ToString()));
            return $"{coreTypeName}[{dimensions}]";
        }

        if (valueRank == 0 || valueRank == 1)
        {
            return $"{coreTypeName}[]";
        }

        return $"{coreTypeName}[{new string(',', valueRank - 1)}]";
    }

    private static object? ConvertValue(JsonElement element, string dataType)
    {
        return dataType switch
        {
            "Boolean" => element.ValueKind is JsonValueKind.True or JsonValueKind.False
                ? element.GetBoolean()
                : bool.Parse(element.GetString() ?? "false"),
            "SByte" => element.ValueKind == JsonValueKind.Number ? element.GetSByte() : sbyte.Parse(element.GetString() ?? "0"),
            "Byte" => element.ValueKind == JsonValueKind.Number ? element.GetByte() : byte.Parse(element.GetString() ?? "0"),
            "Int16" => element.ValueKind == JsonValueKind.Number ? element.GetInt16() : short.Parse(element.GetString() ?? "0"),
            "UInt16" => element.ValueKind == JsonValueKind.Number ? element.GetUInt16() : ushort.Parse(element.GetString() ?? "0"),
            "Int32" => element.ValueKind == JsonValueKind.Number ? element.GetInt32() : int.Parse(element.GetString() ?? "0"),
            "UInt32" => element.ValueKind == JsonValueKind.Number ? element.GetUInt32() : uint.Parse(element.GetString() ?? "0"),
            "Int64" => element.ValueKind == JsonValueKind.Number ? element.GetInt64() : long.Parse(element.GetString() ?? "0"),
            "UInt64" => element.ValueKind == JsonValueKind.Number ? element.GetUInt64() : ulong.Parse(element.GetString() ?? "0"),
            "Float" or "Single" => element.ValueKind == JsonValueKind.Number ? element.GetSingle() : float.Parse(element.GetString() ?? "0"),
            "Double" => element.ValueKind == JsonValueKind.Number ? element.GetDouble() : double.Parse(element.GetString() ?? "0"),
            "DateTime" => element.ValueKind == JsonValueKind.String
                ? DateTime.Parse(element.GetString() ?? string.Empty)
                : element.GetDateTime(),
            _ => element.ValueKind == JsonValueKind.String ? element.GetString() : element.ToString()
        };
    }
}
