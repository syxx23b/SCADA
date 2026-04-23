using System.Collections.Concurrent;
using System.Globalization;
using System.Text.RegularExpressions;
using System.Text.Json;
using S7.Net;
using S7.Net.Types;

namespace Scada.Api.Services;

public sealed class SiemensS7DeviceSessionClient : IDeviceSessionClient
{
    private const int DefaultReconnectInitialDelayMs = 250;
    private const int DefaultReconnectMaxDelayMs = 1500;
    private const int DefaultReconnectFaultThreshold = 8;
    private const int DefaultOpenTimeoutMs = 1500;

    private readonly ILogger<SiemensS7DeviceSessionClient> _logger;
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly SemaphoreSlim _ioGate = new(1, 1);
    private readonly ConcurrentDictionary<Guid, DeviceSubscriptionDefinition> _subscriptions = new();

    private Plc? _plc;
    private DeviceConnectionOptions? _options;
    private CancellationTokenSource? _pollingCancellation;
    private Task? _pollingTask;
    private bool _disposed;
    private int _reconnectInitialDelayMs = DefaultReconnectInitialDelayMs;
    private int _reconnectMaxDelayMs = DefaultReconnectMaxDelayMs;
    private int _reconnectFaultThreshold = DefaultReconnectFaultThreshold;
    private int _openTimeoutMs = DefaultOpenTimeoutMs;

    public SiemensS7DeviceSessionClient(ILogger<SiemensS7DeviceSessionClient> logger)
    {
        _logger = logger;
    }

    public event EventHandler<DeviceValueChange>? ValueChanged;

    public event EventHandler<DeviceConnectionStateChanged>? ConnectionStateChanged;

    public DeviceConnectionState State { get; private set; } = DeviceConnectionState.Disconnected;

    public async Task ConnectAsync(DeviceConnectionOptions options, CancellationToken cancellationToken)
    {
        await _gate.WaitAsync(cancellationToken);
        try
        {
            _options = options;
            UpdateState(DeviceConnectionState.Connecting, "Connecting to Siemens S7 endpoint.");

            var endpoint = ParseEndpoint(options.EndpointUrl);
            _reconnectInitialDelayMs = endpoint.ReconnectInitialDelayMs;
            _reconnectMaxDelayMs = endpoint.ReconnectMaxDelayMs;
            _reconnectFaultThreshold = endpoint.ReconnectFaultThreshold;
            _openTimeoutMs = endpoint.OpenTimeoutMs;
            _plc = new Plc(endpoint.CpuType, endpoint.Host, endpoint.Port, (short)endpoint.Rack, (short)endpoint.Slot);

            await OpenPlcAsync(_plc, cancellationToken);
            StartPollingLoop();
            UpdateState(DeviceConnectionState.Connected, $"Connected to S7 ({endpoint.Host}:{endpoint.Port}, rack {endpoint.Rack}, slot {endpoint.Slot}).");
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            UpdateState(DeviceConnectionState.Faulted, $"Siemens S7 connection failed: {ex.Message}");
            throw;
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
            StopPollingLoop();
            _subscriptions.Clear();
            await ClosePlcAsync(cancellationToken);
            UpdateState(DeviceConnectionState.Disconnected, "Siemens S7 session disconnected.");
        }
        finally
        {
            _gate.Release();
        }
    }

    public Task<IReadOnlyList<DeviceBrowseNode>> BrowseAsync(string? nodeId, CancellationToken cancellationToken)
    {
        // Absolute-address mode: no online browse tree.
        var examples = new[]
        {
            new DeviceBrowseNode("DB1.DBX0.0", "DB1.DBX0.0", "DB1.DBX0.0", "AbsoluteAddress", false, "Boolean", true),
            new DeviceBrowseNode("DB1.DBW2", "DB1.DBW2", "DB1.DBW2", "AbsoluteAddress", false, "Int16", true),
            new DeviceBrowseNode("DB1.DBD4", "DB1.DBD4", "DB1.DBD4", "AbsoluteAddress", false, "Int32/Real", true),
            new DeviceBrowseNode("M0.0", "M0.0", "M0.0", "AbsoluteAddress", false, "Boolean", true)
        };

        return Task.FromResult<IReadOnlyList<DeviceBrowseNode>>(examples);
    }

    public Task ApplySubscriptionsAsync(IReadOnlyCollection<DeviceSubscriptionDefinition> subscriptions, CancellationToken cancellationToken)
    {
        _subscriptions.Clear();
        foreach (var subscription in subscriptions)
        {
            _subscriptions[subscription.TagId] = subscription;
        }

        return Task.CompletedTask;
    }

    public async Task<DeviceWriteResult> WriteAsync(DeviceWriteRequest request, CancellationToken cancellationToken)
    {
        try
        {
            var plc = EnsureConnected();
            await _ioGate.WaitAsync(cancellationToken);
            try
            {
                if (TryParseStringSpec(request.NodeId, request.DataType, out var stringSpec))
                {
                    var stringValue = ConvertJsonValue(request.Value, request.DataType, request.NodeId)?.ToString() ?? string.Empty;
                    await Task.Run(() => plc.WriteBytes(DataType.DataBlock, stringSpec.DbNumber, stringSpec.StartByte, StringEx.ToByteArray(stringValue, stringSpec.MaxLength)), cancellationToken);
                }
                else
                {
                    var typedValue = ConvertJsonValue(request.Value, request.DataType, request.NodeId);
                    await Task.Run(() => plc.Write(request.NodeId, typedValue), cancellationToken);
                }
            }
            finally
            {
                _ioGate.Release();
            }

            return new DeviceWriteResult(request.TagId, true, "Good", null);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to write Siemens S7 address {NodeId}.", request.NodeId);
            return new DeviceWriteResult(request.TagId, false, "Bad", ex.Message);
        }
    }

    public async ValueTask DisposeAsync()
    {
        if (_disposed)
        {
            return;
        }

        StopPollingLoop();
        await ClosePlcAsync(CancellationToken.None);
        _pollingCancellation?.Dispose();
        _ioGate.Dispose();
        _gate.Dispose();
        _disposed = true;
        await ValueTask.CompletedTask;
    }

    private void StartPollingLoop()
    {
        StopPollingLoop();
        _pollingCancellation = new CancellationTokenSource();
        _pollingTask = Task.Run(() => PollLoopAsync(_pollingCancellation.Token));
    }

    private void StopPollingLoop()
    {
        _pollingCancellation?.Cancel();
        _pollingCancellation?.Dispose();
        _pollingCancellation = null;
        _pollingTask = null;
    }

    private async Task PollLoopAsync(CancellationToken cancellationToken)
    {
        while (!cancellationToken.IsCancellationRequested)
        {
            try
            {
                var plc = EnsureConnected();
                foreach (var subscription in _subscriptions.Values)
                {
                    cancellationToken.ThrowIfCancellationRequested();
                    object? rawValue;

                    await _ioGate.WaitAsync(cancellationToken);
                    try
                    {
                        if (TryParseStringSpec(subscription.NodeId, subscription.DataType, out var stringSpec))
                        {
                            rawValue = await Task.Run(() =>
                            {
                                var bytes = plc.ReadBytes(DataType.DataBlock, stringSpec.DbNumber, stringSpec.StartByte, stringSpec.MaxLength + 2);
                                return StringEx.FromByteArray(bytes);
                            }, cancellationToken);
                        }
                        else
                        {
                            rawValue = await Task.Run(() => plc.Read(subscription.NodeId), cancellationToken);
                        }
                    }
                    finally
                    {
                        _ioGate.Release();
                    }

                    var normalizedValue = NormalizeReadValue(rawValue, subscription.DataType, subscription.NodeId);
                    var now = DateTimeOffset.UtcNow;
                    ValueChanged?.Invoke(this, new DeviceValueChange(
                        _options!.DeviceId,
                        subscription.TagId,
                        normalizedValue,
                        "Good",
                        now,
                        now));
                }

                var delay = ResolveDelay();
                await Task.Delay(delay, cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Siemens S7 polling loop failed.");
                UpdateState(DeviceConnectionState.Reconnecting, ex.Message);
                await AttemptReconnectAsync(cancellationToken);
            }
        }
    }

    private async Task AttemptReconnectAsync(CancellationToken cancellationToken)
    {
        var attempt = 0;
        var delayMs = _reconnectInitialDelayMs;
        var faultedEmitted = false;

        while (!cancellationToken.IsCancellationRequested)
        {
            attempt++;
            try
            {
                var plc = EnsureConnected();
                await _ioGate.WaitAsync(cancellationToken);
                try
                {
                    await Task.Run(() =>
                    {
                        try
                        {
                            if (plc.IsConnected)
                            {
                                plc.Close();
                            }
                        }
                        catch
                        {
                            // Ignore close errors during reconnect; open path below will validate final state.
                        }
                    }, cancellationToken);

                    await OpenCoreWithTimeoutAsync(plc, cancellationToken);
                }
                finally
                {
                    _ioGate.Release();
                }

                if (plc.IsConnected)
                {
                    UpdateState(DeviceConnectionState.Connected, $"Siemens S7 polling restored after {attempt} attempt(s).");
                    return;
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Reconnect attempt {Attempt} failed.", attempt);
            }

            if (attempt >= _reconnectFaultThreshold && !faultedEmitted)
            {
                UpdateState(DeviceConnectionState.Faulted, $"Siemens S7 reconnect failed after {attempt} attempts. Keep retrying...");
                faultedEmitted = true;
            }

            await Task.Delay(TimeSpan.FromMilliseconds(delayMs), cancellationToken);
            delayMs = Math.Min(_reconnectMaxDelayMs, delayMs * 2);
        }
    }

    private TimeSpan ResolveDelay()
    {
        var interval = _subscriptions.Count == 0
            ? 500
            : Math.Max(100, _subscriptions.Values.Min(item => item.SamplingIntervalMs));
        return TimeSpan.FromMilliseconds(interval);
    }

    private Plc EnsureConnected()
    {
        if (_plc is null || _options is null)
        {
            throw new InvalidOperationException("Siemens S7 driver is not connected.");
        }

        return _plc;
    }

    private async Task OpenPlcAsync(Plc plc, CancellationToken cancellationToken)
    {
        await _ioGate.WaitAsync(cancellationToken);
        try
        {
            await OpenCoreWithTimeoutAsync(plc, cancellationToken);
        }
        finally
        {
            _ioGate.Release();
        }
    }

    private async Task OpenCoreWithTimeoutAsync(Plc plc, CancellationToken cancellationToken)
    {
        var timeoutMs = Math.Max(200, _openTimeoutMs);
        using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
        var openTask = Task.Run(() => plc.Open(), CancellationToken.None);
        var timeoutTask = Task.Delay(timeoutMs, timeoutCts.Token);
        var completed = await Task.WhenAny(openTask, timeoutTask);

        if (completed != openTask)
        {
            try
            {
                if (plc.IsConnected)
                {
                    plc.Close();
                }
            }
            catch
            {
                // Ignore cleanup exceptions on timeout path.
            }

            throw new TimeoutException($"S7 open timeout ({timeoutMs} ms).");
        }

        timeoutCts.Cancel();
        await openTask;
        if (!plc.IsConnected)
        {
            throw new InvalidOperationException("S7 connection failed.");
        }
    }

    private async Task ClosePlcAsync(CancellationToken cancellationToken)
    {
        var plc = _plc;
        _plc = null;
        if (plc is null)
        {
            return;
        }

        await _ioGate.WaitAsync(cancellationToken);
        try
        {
            await Task.Run(() =>
            {
                if (plc.IsConnected)
                {
                    plc.Close();
                }
            }, cancellationToken);
        }
        finally
        {
            _ioGate.Release();
        }
    }

    private static S7Endpoint ParseEndpoint(string endpointUrl)
    {
        if (string.IsNullOrWhiteSpace(endpointUrl))
        {
            throw new ArgumentException("Endpoint URL is required.");
        }

        var input = endpointUrl.Trim();
        string host;
        var port = 102;
        var rack = 0;
        var slot = 1;
        var cpuType = CpuType.S71500;
        var reconnectInitialDelayMs = DefaultReconnectInitialDelayMs;
        var reconnectMaxDelayMs = DefaultReconnectMaxDelayMs;
        var reconnectFaultThreshold = DefaultReconnectFaultThreshold;
        var openTimeoutMs = DefaultOpenTimeoutMs;

        if (Uri.TryCreate(input, UriKind.Absolute, out var uri))
        {
            host = uri.Host;
            if (uri.Port > 0)
            {
                port = uri.Port;
            }

            ParseQuery(uri.Query, ref port, ref rack, ref slot, ref cpuType, ref reconnectInitialDelayMs, ref reconnectMaxDelayMs, ref reconnectFaultThreshold, ref openTimeoutMs);
        }
        else
        {
            ParseHostPort(input, out host, ref port);
        }

        if (string.IsNullOrWhiteSpace(host))
        {
            throw new ArgumentException("Unable to parse Siemens S7 host from endpoint.");
        }

        reconnectInitialDelayMs = Math.Max(100, reconnectInitialDelayMs);
        reconnectMaxDelayMs = Math.Max(reconnectInitialDelayMs, reconnectMaxDelayMs);
        reconnectFaultThreshold = Math.Max(1, reconnectFaultThreshold);
        openTimeoutMs = Math.Max(200, openTimeoutMs);

        return new S7Endpoint(host, port, rack, slot, cpuType, reconnectInitialDelayMs, reconnectMaxDelayMs, reconnectFaultThreshold, openTimeoutMs);
    }

    private static void ParseHostPort(string input, out string host, ref int port)
    {
        var index = input.LastIndexOf(':');
        if (index > 0 && index < input.Length - 1 && int.TryParse(input[(index + 1)..], out var parsedPort))
        {
            host = input[..index].Trim();
            port = parsedPort;
            return;
        }

        host = input.Trim();
    }

    private static void ParseQuery(
        string query,
        ref int port,
        ref int rack,
        ref int slot,
        ref CpuType cpuType,
        ref int reconnectInitialDelayMs,
        ref int reconnectMaxDelayMs,
        ref int reconnectFaultThreshold,
        ref int openTimeoutMs)
    {
        if (string.IsNullOrWhiteSpace(query))
        {
            return;
        }

        var trimmed = query.TrimStart('?');
        foreach (var segment in trimmed.Split('&', StringSplitOptions.RemoveEmptyEntries))
        {
            var parts = segment.Split('=', 2);
            if (parts.Length != 2)
            {
                continue;
            }

            var key = Uri.UnescapeDataString(parts[0]).Trim().ToLowerInvariant();
            var value = Uri.UnescapeDataString(parts[1]).Trim();

            switch (key)
            {
                case "port" when int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedPort):
                    port = parsedPort;
                    break;
                case "rack" when int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedRack):
                    rack = parsedRack;
                    break;
                case "slot" when int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedSlot):
                    slot = parsedSlot;
                    break;
                case "cpu":
                case "model":
                    cpuType = ParseCpuType(value);
                    break;
                case "reconnectinitialms":
                case "reconnect_initial_ms":
                case "reconnectdelayms":
                    if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedInitialDelay))
                    {
                        reconnectInitialDelayMs = parsedInitialDelay;
                    }
                    break;
                case "reconnectmaxms":
                case "reconnect_max_ms":
                    if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedMaxDelay))
                    {
                        reconnectMaxDelayMs = parsedMaxDelay;
                    }
                    break;
                case "reconnectfaultthreshold":
                case "reconnect_fault_threshold":
                    if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedThreshold))
                    {
                        reconnectFaultThreshold = parsedThreshold;
                    }
                    break;
                case "opentimeoutms":
                case "open_timeout_ms":
                case "timeoutms":
                    if (int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedOpenTimeout))
                    {
                        openTimeoutMs = parsedOpenTimeout;
                    }
                    break;
            }
        }
    }

    private static CpuType ParseCpuType(string value)
    {
        var normalized = value.Trim().ToLowerInvariant();
        return normalized switch
        {
            "1200" or "s7-1200" or "s71200" => CpuType.S71200,
            "1500" or "s7-1500" or "s71500" => CpuType.S71500,
            _ => CpuType.S71500
        };
    }

    private static object ConvertJsonValue(JsonElement value, string? dataType, string nodeId)
    {
        var normalized = dataType?.Trim().ToLowerInvariant() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(normalized))
        {
            normalized = InferDataTypeFromAddress(nodeId);
        }

        return normalized switch
        {
            var item when item.Contains("bool") || item == "bit" => ParseBooleanValue(value),
            var item when item.Contains("byte") && !item.Contains("string") => value.ValueKind == JsonValueKind.Number ? value.GetByte() : byte.Parse(value.GetString()!, CultureInfo.InvariantCulture),
            var item when item.Contains("sbyte") => value.ValueKind == JsonValueKind.Number ? value.GetSByte() : sbyte.Parse(value.GetString()!, CultureInfo.InvariantCulture),
            var item when item.Contains("int16") || item == "int" || item.Contains("short") => value.ValueKind == JsonValueKind.Number ? value.GetInt16() : short.Parse(value.GetString()!, CultureInfo.InvariantCulture),
            var item when item.Contains("uint16") || item.Contains("word") => value.ValueKind == JsonValueKind.Number ? value.GetUInt16() : ushort.Parse(value.GetString()!, CultureInfo.InvariantCulture),
            var item when item.Contains("int32") || item.Contains("dint") => value.ValueKind == JsonValueKind.Number ? value.GetInt32() : int.Parse(value.GetString()!, CultureInfo.InvariantCulture),
            var item when item.Contains("uint32") || item.Contains("dword") || item.Contains("udint") => value.ValueKind == JsonValueKind.Number ? value.GetUInt32() : uint.Parse(value.GetString()!, CultureInfo.InvariantCulture),
            var item when item.Contains("int64") || item.Contains("lint") || item.Contains("long") => value.ValueKind == JsonValueKind.Number ? value.GetInt64() : long.Parse(value.GetString()!, CultureInfo.InvariantCulture),
            var item when item.Contains("uint64") || item.Contains("ulint") || item.Contains("lword") => value.ValueKind == JsonValueKind.Number ? value.GetUInt64() : ulong.Parse(value.GetString()!, CultureInfo.InvariantCulture),
            var item when item.Contains("float") || item.Contains("real") => value.ValueKind == JsonValueKind.Number ? value.GetSingle() : float.Parse(value.GetString()!, CultureInfo.InvariantCulture),
            var item when item.Contains("double") || item.Contains("lreal") => value.ValueKind == JsonValueKind.Number ? value.GetDouble() : double.Parse(value.GetString()!, CultureInfo.InvariantCulture),
            _ => value.ValueKind == JsonValueKind.String ? value.GetString() ?? string.Empty : value.GetRawText()
        };
    }

    private static bool ParseBooleanValue(JsonElement value)
    {
        return value.ValueKind switch
        {
            JsonValueKind.True => true,
            JsonValueKind.False => false,
            JsonValueKind.Number => value.TryGetInt64(out var numeric) ? numeric != 0 : throw new FormatException("Boolean number must be 0 or 1."),
            JsonValueKind.String => ParseBooleanString(value.GetString()),
            _ => throw new FormatException($"Unsupported JSON kind for Boolean conversion: {value.ValueKind}.")
        };
    }

    private static bool ParseBooleanString(string? rawValue)
    {
        var normalized = rawValue?.Trim().ToLowerInvariant() ?? string.Empty;
        return normalized switch
        {
            "1" or "true" or "yes" or "y" or "on" => true,
            "0" or "false" or "no" or "n" or "off" => false,
            _ => bool.TryParse(normalized, out var parsed)
                ? parsed
                : throw new FormatException($"Cannot parse '{rawValue}' as Boolean.")
        };
    }

    private static string InferDataTypeFromAddress(string nodeId)
    {
        var upper = nodeId.Trim().ToUpperInvariant();
        if (upper.Contains("STRING["))
        {
            return "String";
        }

        if (upper.Contains("DBX") || upper.EndsWith(".0") || upper.StartsWith("I") || upper.StartsWith("Q") || upper.StartsWith("M"))
        {
            if (upper.Contains("DBX") || upper.StartsWith("I") && upper.Contains(".") || upper.StartsWith("Q") && upper.Contains(".") || upper.StartsWith("M") && upper.Contains("."))
            {
                return "Boolean";
            }
        }

        if (upper.Contains("DBB") || upper.StartsWith("IB") || upper.StartsWith("QB") || upper.StartsWith("MB"))
        {
            return "Byte";
        }

        if (upper.Contains("DBW") || upper.StartsWith("IW") || upper.StartsWith("QW") || upper.StartsWith("MW"))
        {
            return "Int16";
        }

        if (upper.Contains("DBD") || upper.StartsWith("ID") || upper.StartsWith("QD") || upper.StartsWith("MD"))
        {
            return "Int32";
        }

        return "String";
    }

    private static object? NormalizeReadValue(object? rawValue, string? dataType, string nodeId)
    {
        if (rawValue is null)
        {
            return null;
        }

        var normalized = dataType?.Trim().ToLowerInvariant() ?? string.Empty;
        if (string.IsNullOrWhiteSpace(normalized))
        {
            normalized = InferDataTypeFromAddress(nodeId).ToLowerInvariant();
        }

        try
        {
            if (normalized.Contains("real") || normalized.Contains("float"))
            {
                return rawValue switch
                {
                    uint u32 => BitConverter.UInt32BitsToSingle(u32),
                    int i32 => BitConverter.Int32BitsToSingle(i32),
                    _ => Convert.ToSingle(rawValue, CultureInfo.InvariantCulture)
                };
            }

            if (normalized.Contains("dint"))
            {
                return rawValue switch
                {
                    uint u32 => unchecked((int)u32),
                    _ => Convert.ToInt32(rawValue, CultureInfo.InvariantCulture)
                };
            }

            if (normalized == "int" || normalized.Contains("int16") || normalized.Contains("short"))
            {
                return rawValue switch
                {
                    ushort u16 => unchecked((short)u16),
                    _ => Convert.ToInt16(rawValue, CultureInfo.InvariantCulture)
                };
            }

            if (normalized.Contains("word") || normalized.Contains("uint16"))
            {
                return Convert.ToUInt16(rawValue, CultureInfo.InvariantCulture);
            }

            if (normalized.Contains("bool"))
            {
                return rawValue switch
                {
                    bool b => b,
                    byte bt => bt != 0,
                    _ => Convert.ToBoolean(rawValue, CultureInfo.InvariantCulture)
                };
            }
        }
        catch
        {
            // Keep raw fallback for unknown/invalid conversion cases.
        }

        return rawValue;
    }

    private static bool TryParseStringSpec(string nodeId, string? dataType, out S7StringSpec spec)
    {
        spec = default;

        var maxLength = TryParseStringLength(nodeId) ?? TryParseStringLength(dataType);
        if (maxLength is null)
        {
            return false;
        }

        var match = Regex.Match(nodeId.Trim(), @"^DB(?<db>\d+)\.DBB(?<start>\d+)", RegexOptions.IgnoreCase);
        if (!match.Success)
        {
            return false;
        }

        spec = new S7StringSpec(
            int.Parse(match.Groups["db"].Value, CultureInfo.InvariantCulture),
            int.Parse(match.Groups["start"].Value, CultureInfo.InvariantCulture),
            maxLength.Value);
        return true;
    }

    private static int? TryParseStringLength(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return null;
        }

        var match = Regex.Match(value, @"STRING\[(?<len>\d+)\]", RegexOptions.IgnoreCase);
        if (!match.Success)
        {
            return null;
        }

        return int.Parse(match.Groups["len"].Value, CultureInfo.InvariantCulture);
    }

    private void UpdateState(DeviceConnectionState state, string message)
    {
        State = state;
        if (_options is not null)
        {
            ConnectionStateChanged?.Invoke(this, new DeviceConnectionStateChanged(_options.DeviceId, state, message));
        }
    }

    private readonly record struct S7StringSpec(int DbNumber, int StartByte, int MaxLength);
    private sealed record S7Endpoint(
        string Host,
        int Port,
        int Rack,
        int Slot,
        CpuType CpuType,
        int ReconnectInitialDelayMs,
        int ReconnectMaxDelayMs,
        int ReconnectFaultThreshold,
        int OpenTimeoutMs);
}
