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
    private Task? _backgroundReconnectTask;
    private CancellationTokenSource? _pollingCancellation;
    private Task? _pollingTask;
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
            _backgroundReconnectTask = null;
            StopPollingLoop();

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
            var builtInType = variableNode is not null
                ? TypeInfo.GetBuiltInType(variableNode.DataType, _session.TypeTree)
                : BuiltInType.Null;

            var dataType = variableNode is not null
                ? FormatVariableDataType(variableNode, builtInType)
                : null;

            var writable = variableNode is not null &&
                           (variableNode.UserAccessLevel & AccessLevels.CurrentWrite) == AccessLevels.CurrentWrite;

            var hasChildren = reference.NodeClass == NodeClass.Object ||
                              (childNodeId is not null &&
                               variableNode is not null &&
                               ShouldProbeVariableChildren(variableNode, builtInType) &&
                               HasHierarchicalChildren(childNodeId));

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
                    MonitoringMode = MonitoringMode.Reporting,
                    Filter = new DataChangeFilter
                    {
                        Trigger = DataChangeTrigger.StatusValueTimestamp,
                        DeadbandType = (uint)DeadbandType.None,
                        DeadbandValue = 0
                    },
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

        try
        {
            _configuration ??= await CreateConfigurationAsync(cancellationToken);

            var endpoint = await ResolveEndpointAsync(_configuration, _options, cancellationToken);
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
            EnsurePollingLoop();

            UpdateState(OpcUaConnectionState.Connected, $"Connected to {_options.EndpointUrl}.");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            UpdateState(OpcUaConnectionState.Faulted, $"Connect failed: {exception.Message}");
            throw;
        }
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

    private async Task<EndpointDescription> ResolveEndpointAsync(
        ApplicationConfiguration configuration,
        OpcUaConnectionOptions options,
        CancellationToken cancellationToken)
    {
        try
        {
            var endpoint = await CoreClientUtils.SelectEndpointAsync(
                configuration,
                options.EndpointUrl,
                UseSecurity(options),
                15000,
                cancellationToken);

            endpoint.EndpointUrl = options.EndpointUrl;
            endpoint.SecurityMode = ParseSecurityMode(options.SecurityMode);
            endpoint.SecurityPolicyUri = ParseSecurityPolicy(options.SecurityPolicy);
            return endpoint;
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Failed to discover OPC UA endpoint for {EndpointUrl}. Falling back to direct endpoint connection.", options.EndpointUrl);
            return CreateDirectEndpoint(options);
        }
    }

    private static EndpointDescription CreateDirectEndpoint(OpcUaConnectionOptions options)
    {
        var tokenType = options.AuthenticationMode == OpcUaAuthenticationMode.UsernamePassword
            ? UserTokenType.UserName
            : UserTokenType.Anonymous;

        return new EndpointDescription
        {
            EndpointUrl = options.EndpointUrl,
            SecurityMode = ParseSecurityMode(options.SecurityMode),
            SecurityPolicyUri = ParseSecurityPolicy(options.SecurityPolicy),
            TransportProfileUri = Profiles.UaTcpTransport,
            UserIdentityTokens = new UserTokenPolicyCollection
            {
                new()
                {
                    PolicyId = tokenType == UserTokenType.Anonymous ? "anonymous" : "username",
                    TokenType = tokenType,
                    SecurityPolicyUri = SecurityPolicies.None
                }
            },
            Server = new ApplicationDescription
            {
                ApplicationName = options.DeviceName,
                ApplicationType = ApplicationType.Server,
                DiscoveryUrls = new StringCollection { options.EndpointUrl }
            }
        };
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
        EnsureBackgroundReconnectLoop();
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
            _reconnectHandler?.Dispose();
            _reconnectHandler = null;
            UpdateState(OpcUaConnectionState.Faulted, exception.Message);
            EnsureBackgroundReconnectLoop();
        }
    }

    private void EnsureBackgroundReconnectLoop()
    {
        if (_disposed || _backgroundReconnectTask is { IsCompleted: false })
        {
            return;
        }

        _backgroundReconnectTask = Task.Run(BackgroundReconnectLoopAsync);
    }

    private void EnsurePollingLoop()
    {
        if (_disposed || _pollingTask is { IsCompleted: false })
        {
            return;
        }

        _pollingCancellation = new CancellationTokenSource();
        _pollingTask = Task.Run(() => PollingLoopAsync(_pollingCancellation.Token));
    }

    private void StopPollingLoop()
    {
        try
        {
            _pollingCancellation?.Cancel();
        }
        catch (ObjectDisposedException)
        {
            // Ignore
        }

        _pollingCancellation?.Dispose();
        _pollingCancellation = null;
        _pollingTask = null;
    }

    private async Task PollingLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested && !_disposed)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(1), cancellationToken).ConfigureAwait(false);

                if (_session is not { Connected: true } session || _options is null)
                {
                    continue;
                }

                var definitions = _subscriptionDefinitions.Values.ToArray();
                foreach (var definition in definitions)
                {
                    cancellationToken.ThrowIfCancellationRequested();

                    DataValue value;
                    try
                    {
                        value = session.ReadValue(NodeId.Parse(definition.NodeId));
                    }
                    catch (Exception readException)
                    {
                        _logger.LogDebug(readException, "Polling read failed for {NodeId}.", definition.NodeId);
                        continue;
                    }

                    var observedAt = DateTimeOffset.UtcNow;
                    ValueChanged?.Invoke(this, new OpcUaValueChange(
                        _options.DeviceId,
                        definition.TagId,
                        value.Value,
                        value.StatusCode.ToString(),
                        observedAt,
                        observedAt));
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                _logger.LogDebug(exception, "Background polling loop failed.");
            }
        }
    }

    private async Task BackgroundReconnectLoopAsync()
    {
        while (!_disposed)
        {
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(5)).ConfigureAwait(false);

                if (_disposed || _options is null)
                {
                    return;
                }

                await _gate.WaitAsync().ConfigureAwait(false);
                try
                {
                    if (_disposed || State is OpcUaConnectionState.Connected or OpcUaConnectionState.Disconnected)
                    {
                        return;
                    }

                    _reconnectHandler?.Dispose();
                    _reconnectHandler = null;

                    if (_session is not null)
                    {
                        try
                        {
                            _session.KeepAlive -= SessionOnKeepAlive;
                            _session.Dispose();
                        }
                        catch (Exception disposeException)
                        {
                            _logger.LogDebug(disposeException, "Ignored OPC UA session dispose failure during reconnect recovery.");
                        }

                        _session = null;
                    }

                    await EnsureConnectedCoreAsync(CancellationToken.None).ConfigureAwait(false);
                    await ApplySubscriptionsAsync(_subscriptionDefinitions.Values.ToArray(), CancellationToken.None).ConfigureAwait(false);
                    UpdateState(OpcUaConnectionState.Connected, "Session reconnected.");
                    return;
                }
                finally
                {
                    _gate.Release();
                }
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Background OPC UA reconnect attempt failed.");
                UpdateState(OpcUaConnectionState.Reconnecting, "Retrying OPC UA connection.");
            }
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

    private static bool ShouldProbeVariableChildren(VariableNode variableNode, BuiltInType builtInType)
    {
        if (builtInType == BuiltInType.ExtensionObject)
        {
            return true;
        }

        return variableNode.ValueRank >= 0 || variableNode.ArrayDimensions is { Count: > 0 };
    }

    private string FormatVariableDataType(VariableNode variableNode, BuiltInType builtInType)
    {
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
        var normalizedType = dataType.Trim();
        return normalizedType switch
        {
            "Boolean" => ConvertBooleanValue(element),
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

    private static bool ConvertBooleanValue(JsonElement element)
    {
        return element.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => element.GetDouble() != 0,
            JsonValueKind.String => ParseBooleanString(element.GetString()),
            _ => throw new FormatException($"Unsupported JSON value kind for Boolean: {element.ValueKind}.")
        };
    }

    private static bool ParseBooleanString(string? rawValue)
    {
        var normalized = rawValue?.Trim().ToLowerInvariant() ?? string.Empty;
        return normalized switch
        {
            "1" or "true" or "yes" or "on" => true,
            "0" or "false" or "no" or "off" or "" => false,
            _ => throw new FormatException($"Cannot convert '{rawValue}' to Boolean.")
        };
    }
}
