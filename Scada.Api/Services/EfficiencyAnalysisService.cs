using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;

namespace Scada.Api.Services;

public interface IEfficiencyAnalysisService
{
    Task CaptureCurrentStateAsync(CancellationToken cancellationToken);
    Task<EfficiencyTimelineResponseDto> GetTimelineAsync(int hours, int stationCount, CancellationToken cancellationToken);
}

public sealed class EfficiencyAnalysisService : IEfficiencyAnalysisService
{
    private const int DefaultStationCount = 4;
    private const int MaxStationCount = 64;
    private static readonly HashSet<string> DashboardFieldKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "barcode",
        "automode0_factory1_endurance",
        "current",
        "enduranceprocess",
        "errcode",
        "failnumber",
        "flow",
        "frequency",
        "inletpressure",
        "inlettemp",
        "lasttimehour",
        "lasttimeminute",
        "nozzlesize",
        "passnumber",
        "power",
        "powerfactor",
        "pressure",
        "siphon",
        "speed",
        "stationnumber",
        "triggercount",
        "triggeroffprocess",
        "triggeronprocess",
        "voltage",
        "workflow",
    };
    private static readonly TimeSpan DataRetention = TimeSpan.FromDays(7);

    // 段"仍打开"的判定窗口:最近 3 秒内还在延展(配合 1s 采集,容纳捕获抖动)。
    private static readonly TimeSpan OpenSegmentGrace = TimeSpan.FromSeconds(3);

    // 空白后重启/首开新段时,把 StartedAt 回填 1 个采样,使新段立即可见且时长≈now。
    private static readonly TimeSpan NewSegmentStartBackdate = TimeSpan.FromSeconds(1);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;
    private readonly ILogger<EfficiencyAnalysisService> _logger;
    private readonly SemaphoreSlim _syncLock = new(1, 1);

    // 一次性清理旧版本残留的 Disconnected 段(新语义不再把"未工作"落库)。
    private bool _disconnectedSegmentsPurged;

    public EfficiencyAnalysisService(
        IServiceScopeFactory scopeFactory,
        IScadaRuntimeCoordinator runtimeCoordinator,
        ILogger<EfficiencyAnalysisService> logger)
    {
        _scopeFactory = scopeFactory;
        _runtimeCoordinator = runtimeCoordinator;
        _logger = logger;
    }

    public async Task CaptureCurrentStateAsync(CancellationToken cancellationToken)
    {
        await _syncLock.WaitAsync(cancellationToken);
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
            var now = DateTimeOffset.UtcNow;
            await PurgeDisconnectedSegmentsOnceAsync(dbContext, cancellationToken);
            await CaptureLiveStateInternalAsync(dbContext, now, null, cancellationToken);
            await CleanupOldSegmentsAsync(dbContext, now, cancellationToken);
            if (dbContext.ChangeTracker.HasChanges())
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
        }
        finally
        {
            _syncLock.Release();
        }
    }

    public async Task<EfficiencyTimelineResponseDto> GetTimelineAsync(int hours, int stationCount, CancellationToken cancellationToken)
    {
        var clampedHours = Math.Clamp(hours, 1, 72);
        var faceplateIndexes = BuildFaceplateIndexes(stationCount);
        await _syncLock.WaitAsync(cancellationToken);
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
            var windowEnd = DateTimeOffset.UtcNow;
            var windowStart = windowEnd.AddHours(-clampedHours);

            await PurgeDisconnectedSegmentsOnceAsync(dbContext, cancellationToken);
            await CaptureLiveStateInternalAsync(dbContext, windowEnd, faceplateIndexes, cancellationToken);
            await CleanupOldSegmentsAsync(dbContext, windowEnd, cancellationToken);
            if (dbContext.ChangeTracker.HasChanges())
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            var segments = await dbContext.EfficiencyTimelineSegments
                .AsNoTracking()
                .Where(item => faceplateIndexes.Contains(item.FaceplateIndex) &&
                               !item.IsDemo &&
                               item.EndedAt >= windowStart &&
                               item.StartedAt <= windowEnd)
                .OrderBy(item => item.FaceplateIndex)
                .ThenBy(item => item.StartedAt)
                .ToListAsync(cancellationToken);

            var lanes = faceplateIndexes.Select(faceplateIndex =>
            {
                var laneSegments = segments
                    .Where(item => item.FaceplateIndex == faceplateIndex)
                    .Select(item => new EfficiencyTimelineSegmentDto(
                        item.FaceplateIndex,
                        item.StationName,
                        item.State.ToStateKey(),
                        item.State.ToStateLabel(),
                        item.State.ToColorHex(),
                        item.StartedAt < windowStart ? windowStart : item.StartedAt,
                        item.EndedAt > windowEnd ? windowEnd : item.EndedAt,
                        item.IsDemo))
                    .Where(item => item.EndedAt > item.StartedAt)
                    .ToList();

                // "now" 状态只看仍在打开(覆盖到窗口终点 windowEnd)的段;
                // 未工作(Disconnected)不再落段,当前无打开段时回退为 disconnected,保持前端契约不变。
                var currentSegment = laneSegments.LastOrDefault(item => item.EndedAt >= windowEnd);
                var lastSegment = laneSegments.LastOrDefault();
                return new EfficiencyTimelineLaneDto(
                    faceplateIndex,
                    currentSegment?.StationName ?? lastSegment?.StationName ?? $"工位{faceplateIndex}",
                    currentSegment?.StateKey ?? EfficiencyStateKind.Disconnected.ToStateKey(),
                    currentSegment?.StateLabel ?? EfficiencyStateKind.Disconnected.ToStateLabel(),
                    currentSegment?.ColorHex ?? EfficiencyStateKind.Disconnected.ToColorHex(),
                    laneSegments);
            }).ToArray();

            return new EfficiencyTimelineResponseDto(windowStart, windowEnd, DateTimeOffset.UtcNow, lanes);
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private async Task CaptureLiveStateInternalAsync(
        ScadaDbContext dbContext,
        DateTimeOffset now,
        IReadOnlyList<int>? requestedFaceplateIndexes,
        CancellationToken cancellationToken)
    {
        try
        {
            var overview = await _runtimeCoordinator.GetRuntimeOverviewAsync(cancellationToken);
            foreach (var state in BuildCurrentBoardStates(overview, requestedFaceplateIndexes ?? ResolveRuntimeFaceplateIndexes(overview)))
            {
                await UpsertCurrentStateAsync(dbContext, state, now, cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Failed to capture live efficiency state, keeping persisted timeline data.");
        }
    }

    private async Task EnsureDemoHistoryAsync(
        ScadaDbContext dbContext,
        DateTimeOffset windowStart,
        DateTimeOffset windowEnd,
        CancellationToken cancellationToken)
    {
        foreach (var faceplateIndex in BuildFaceplateIndexes(DefaultStationCount))
        {
            var earliestSegment = (await dbContext.EfficiencyTimelineSegments
                .Where(item => item.FaceplateIndex == faceplateIndex)
                .ToListAsync(cancellationToken))
                .Where(item => item.EndedAt >= windowStart)
                .OrderBy(item => item.StartedAt)
                .FirstOrDefault();

            var seedEnd = earliestSegment is null ? windowEnd : earliestSegment.StartedAt;
            if (seedEnd <= windowStart)
            {
                continue;
            }

            var stationName = earliestSegment?.StationName ?? $"工位{faceplateIndex}";
            var demoSegments = BuildDemoSegments(faceplateIndex, stationName, windowStart, seedEnd);
            if (demoSegments.Count == 0)
            {
                continue;
            }

            dbContext.EfficiencyTimelineSegments.AddRange(demoSegments);
        }
    }

    private async Task UpsertCurrentStateAsync(
        ScadaDbContext dbContext,
        FaceplateBoardState state,
        DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var latestSegment = await dbContext.EfficiencyTimelineSegments
            .Where(item => item.FaceplateIndex == state.FaceplateIndex)
            .OrderByDescending(item => item.EndedAt)
            .ThenByDescending(item => item.StartedAt)
            .FirstOrDefaultAsync(cancellationToken);

        // 段是否"仍打开":最近 3 秒内仍在延展(配合 1s 采集,3s 缓冲容纳捕获抖动)。
        // 历史残留的 Disconnected 段一律视为已收口,绝不被顺延或拼接。
        var latestStillOpen = latestSegment is not null
            && latestSegment.State != EfficiencyStateKind.Disconnected
            && latestSegment.EndedAt >= now.Add(-OpenSegmentGrace);

        if (state.State == EfficiencyStateKind.Disconnected)
        {
            // 未工作(Disconnected)不入库:若上一条段仍在延展则把它收口到 now;
            // 若早已收口(中间已是未工作空白),什么都不写,保持空白。
            if (latestStillOpen)
            {
                latestSegment!.EndedAt = now;
                latestSegment!.UpdatedAt = now;
            }

            return;
        }

        if (latestSegment is null || !latestStillOpen)
        {
            // 无历史段,或上一条段早已收口(与 now 之间存在未工作空白):
            // 不回填空白,直接从 now 起新段(StartedAt≈now,回填 1 个采样使其立即可见)。
            dbContext.EfficiencyTimelineSegments.Add(CreateLiveSegment(state, now, backdateStart: true));
            return;
        }

        if (latestSegment.State == state.State)
        {
            // 同状态且仍打开:顺延 EndedAt 到 now。
            latestSegment.StationName = state.StationName;
            latestSegment.EndedAt = now;
            latestSegment.UpdatedAt = now;
            latestSegment.IsDemo = false;
            return;
        }

        // 变状态且旧段仍打开:先收口旧段到 now,再开新段(StartedAt≈now,不重叠)。
        latestSegment.EndedAt = now;
        latestSegment.UpdatedAt = now;
        dbContext.EfficiencyTimelineSegments.Add(CreateLiveSegment(state, now, backdateStart: false));
    }

    private static EfficiencyTimelineSegmentEntity CreateLiveSegment(FaceplateBoardState state, DateTimeOffset now, bool backdateStart)
    {
        return new EfficiencyTimelineSegmentEntity
        {
            FaceplateIndex = state.FaceplateIndex,
            StationName = state.StationName,
            State = state.State,
            StartedAt = backdateStart ? now.Add(-NewSegmentStartBackdate) : now,
            EndedAt = now,
            UpdatedAt = now,
            IsDemo = false,
        };
    }

    private async Task PurgeDisconnectedSegmentsOnceAsync(ScadaDbContext dbContext, CancellationToken cancellationToken)
    {
        if (_disconnectedSegmentsPurged)
        {
            return;
        }

        // 旧版本会把 Disconnected 持久化为段;新语义"未工作不入库、只留空白",
        // 服务启动后首次采集/查询时顺带清掉历史残留,保证响应/落库都不再出现 disconnected 段。
        await dbContext.Database.ExecuteSqlRawAsync(
            "DELETE FROM [OEE].[EfficiencyTimelineSegments] WHERE [State] = N'Disconnected'",
            cancellationToken);
        _disconnectedSegmentsPurged = true;
        _logger.LogInformation("Purged legacy Disconnected efficiency timeline segments (unworked is no longer persisted).");
    }

    private async Task CleanupOldSegmentsAsync(ScadaDbContext dbContext, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var cutoff = now - DataRetention;
        var expiredSegments = await dbContext.EfficiencyTimelineSegments
            .Where(item => item.EndedAt < cutoff)
            .ToListAsync(cancellationToken);

        if (expiredSegments.Count > 0)
        {
            dbContext.EfficiencyTimelineSegments.RemoveRange(expiredSegments);
        }
    }

    private static int[] BuildFaceplateIndexes(int stationCount)
    {
        var clampedCount = Math.Clamp(stationCount, 1, MaxStationCount);
        return Enumerable.Range(1, clampedCount).ToArray();
    }

    private static IReadOnlyList<int> ResolveRuntimeFaceplateIndexes(RuntimeOverviewDto overview)
    {
        var maxIndex = DefaultStationCount;
        foreach (var tag in overview.Tags)
        {
            if (TryGetDashboardTemplateField(tag, out var faceplateIndex, out _) && faceplateIndex > maxIndex)
            {
                maxIndex = faceplateIndex;
            }
        }

        return BuildFaceplateIndexes(maxIndex);
    }

    private static List<EfficiencyTimelineSegmentEntity> BuildDemoSegments(
        int faceplateIndex,
        string stationName,
        DateTimeOffset windowStart,
        DateTimeOffset windowEnd)
    {
        // 演示补档只生成工作状态段(Standby/Running/Fault);
        // 未工作(Disconnected)按新语义不生成,靠段间空白呈现。
        var plan = faceplateIndex == 1
            ? new (EfficiencyStateKind State, int Minutes)[]
            {
                (EfficiencyStateKind.Standby, 42),
                (EfficiencyStateKind.Running, 168),
                (EfficiencyStateKind.Fault, 18),
                (EfficiencyStateKind.Standby, 26),
                (EfficiencyStateKind.Running, 144),
                (EfficiencyStateKind.Fault, 12),
                (EfficiencyStateKind.Standby, 34),
            }
            : new (EfficiencyStateKind State, int Minutes)[]
            {
                (EfficiencyStateKind.Standby, 64),
                (EfficiencyStateKind.Running, 132),
                (EfficiencyStateKind.Fault, 24),
                (EfficiencyStateKind.Standby, 38),
                (EfficiencyStateKind.Running, 176),
                (EfficiencyStateKind.Fault, 14),
                (EfficiencyStateKind.Standby, 28),
            };

        var result = new List<EfficiencyTimelineSegmentEntity>();
        var cursor = windowStart;
        var cursorIndex = 0;

        while (cursor < windowEnd)
        {
            var current = plan[cursorIndex % plan.Length];
            var next = cursor.AddMinutes(current.Minutes);
            if (next > windowEnd)
            {
                next = windowEnd;
            }

            result.Add(new EfficiencyTimelineSegmentEntity
            {
                FaceplateIndex = faceplateIndex,
                StationName = stationName,
                State = current.State,
                StartedAt = cursor,
                EndedAt = next,
                UpdatedAt = next,
                IsDemo = true,
            });

            cursor = next;
            cursorIndex += 1;
        }

        return result;
    }

    private static IEnumerable<FaceplateBoardState> BuildCurrentBoardStates(RuntimeOverviewDto overview, IReadOnlyList<int> faceplateIndexes)
    {
        var snapshotByTagId = overview.Snapshots.ToDictionary(item => item.TagId, item => item);
        var deviceStatusById = overview.Devices.ToDictionary(item => item.DeviceId, item => item.Status);
        var indexSet = faceplateIndexes.ToHashSet();
        var tagMapByFaceplate = faceplateIndexes.ToDictionary(
            index => index,
            _ => new Dictionary<string, TagDefinitionDto>(StringComparer.OrdinalIgnoreCase));

        foreach (var tag in overview.Tags)
        {
            if (!TryGetDashboardTemplateField(tag, out var faceplateIndex, out var fieldKey))
            {
                continue;
            }

            if (!indexSet.Contains(faceplateIndex) || !DashboardFieldKeys.Contains(fieldKey))
            {
                continue;
            }

            tagMapByFaceplate[faceplateIndex][fieldKey] = tag;
        }

        foreach (var faceplateIndex in faceplateIndexes)
        {
            var faceplateTagMap = tagMapByFaceplate[faceplateIndex];
            var faceplateTags = faceplateTagMap.Values
                .GroupBy(tag => tag.Id)
                .Select(group => group.First())
                .ToArray();

            if (faceplateTags.Length == 0)
            {
                // Keep timeline aligned with dashboard fallback: no matching tags => disconnected.
                yield return new FaceplateBoardState(faceplateIndex, $"工位{faceplateIndex}", EfficiencyStateKind.Disconnected);
                continue;
            }

            var stationNumber = ReadNumericValue(faceplateTagMap, snapshotByTagId, "stationnumber");
            var workflow = ReadNumericValue(faceplateTagMap, snapshotByTagId, "workflow");
            var errCode = ReadNumericValue(faceplateTagMap, snapshotByTagId, "errcode");
            var hasConnectedDevice = faceplateTags.Any(tag =>
                deviceStatusById.TryGetValue(tag.DeviceId, out var status) && string.Equals(status, "connected", StringComparison.OrdinalIgnoreCase));
            var hasGoodSnapshot = faceplateTags.Any(tag =>
            {
                if (!snapshotByTagId.TryGetValue(tag.Id, out var snapshot))
                {
                    return false;
                }

                var status = deviceStatusById.TryGetValue(tag.DeviceId, out var deviceStatus)
                    ? deviceStatus
                    : string.Empty;
                return IsHealthySnapshot(snapshot, status);
            });
            var hasDeviceDisconnecting = faceplateTags
                .Select(tag => deviceStatusById.TryGetValue(tag.DeviceId, out var status) ? status : string.Empty)
                .Where(value => !string.IsNullOrWhiteSpace(value))
                .Distinct(StringComparer.OrdinalIgnoreCase)
                .Any(status =>
                    status.Contains("reconnect", StringComparison.OrdinalIgnoreCase) ||
                    status.Contains("disconnect", StringComparison.OrdinalIgnoreCase) ||
                    status.Contains("offline", StringComparison.OrdinalIgnoreCase) ||
                    status.Contains("fault", StringComparison.OrdinalIgnoreCase) ||
                    status.Contains("error", StringComparison.OrdinalIgnoreCase));

            var connected = hasConnectedDevice && !hasDeviceDisconnecting && hasGoodSnapshot;
            var state = !connected
                ? EfficiencyStateKind.Disconnected
                : (errCode ?? 0) > 0
                    ? EfficiencyStateKind.Fault
                    : (workflow ?? 0) > 0
                        ? EfficiencyStateKind.Running
                        : EfficiencyStateKind.Standby;

            yield return new FaceplateBoardState(
                faceplateIndex,
                stationNumber is not null ? $"工位{Math.Round(stationNumber.Value)}" : $"工位{faceplateIndex}",
                state);
        }
    }

    private static double? ReadNumericValue(
        IReadOnlyList<TagDefinitionDto> faceplateTags,
        int faceplateIndex,
        IReadOnlyDictionary<Guid, TagSnapshotDto> snapshotByTagId,
        string key)
    {
        var tag = faceplateTags.FirstOrDefault(item =>
        {
            var shortLabel = ShortLabelForFaceplate(item, faceplateIndex);
            return string.Equals(shortLabel, key, StringComparison.OrdinalIgnoreCase);
        });

        if (tag is null || !snapshotByTagId.TryGetValue(tag.Id, out var snapshot))
        {
            return null;
        }

        return ToNumericValue(snapshot.Value);
    }

    private static double? ReadNumericValue(
        IReadOnlyDictionary<string, TagDefinitionDto> faceplateTagMap,
        IReadOnlyDictionary<Guid, TagSnapshotDto> snapshotByTagId,
        string key)
    {
        if (!faceplateTagMap.TryGetValue(key, out var tag) || !snapshotByTagId.TryGetValue(tag.Id, out var snapshot))
        {
            return null;
        }

        return ToNumericValue(snapshot.Value);
    }

    private static string ShortLabelForFaceplate(TagDefinitionDto tag, int faceplateIndex)
    {
        var candidates = GetTagNameCandidates(tag);
        var prefixes = new[]
        {
            $"HMI_DB.HMI_Faceplates[{faceplateIndex}].",
            $"HMI_DB.Faceplates[{faceplateIndex}].",
        };

        foreach (var displayName in candidates)
        {
            foreach (var prefix in prefixes)
            {
                if (displayName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                {
                    return displayName[prefix.Length..];
                }
            }

            if (displayName.Equals($"HMI_DB.barcode[{faceplateIndex}]", StringComparison.OrdinalIgnoreCase))
            {
                return "barcode";
            }
        }

        return candidates.FirstOrDefault() ?? GetDisplayName(tag.NodeId);
    }

    private static IReadOnlyList<string> GetTagNameCandidates(TagDefinitionDto tag)
    {
        return new[]
            {
                tag.DisplayName,
                tag.BrowseName,
                GetDisplayName(tag.NodeId),
            }
            .Select(item => item?.Trim() ?? string.Empty)
            .Where(item => !string.IsNullOrWhiteSpace(item))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToArray();
    }

    private static bool TryGetDashboardTemplateField(TagDefinitionDto tag, out int faceplateIndex, out string fieldKey)
    {
        faceplateIndex = 0;
        fieldKey = string.Empty;

        var candidates = GetTagNameCandidates(tag);
        foreach (var displayName in candidates)
        {
            if (TryParseDashboardFieldFromName(displayName, out faceplateIndex, out fieldKey))
            {
                return true;
            }
        }

        return false;
    }

    private static bool TryParseDashboardFieldFromName(string rawValue, out int faceplateIndex, out string fieldKey)
    {
        faceplateIndex = 0;
        fieldKey = string.Empty;

        var value = rawValue.Trim();
        if (value.Length == 0)
        {
            return false;
        }

        var barcodeMatch = System.Text.RegularExpressions.Regex.Match(value, @"^HMI_DB\.barcode\[(\d+)\]$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (barcodeMatch.Success)
        {
            faceplateIndex = int.Parse(barcodeMatch.Groups[1].Value);
            fieldKey = "barcode";
            return true;
        }

        var faceplateMatch = System.Text.RegularExpressions.Regex.Match(value, @"^HMI_DB\.(?:HMI_Faceplates|Faceplates)\[(\d+)\]\.([a-z0-9_]+)$", System.Text.RegularExpressions.RegexOptions.IgnoreCase);
        if (!faceplateMatch.Success)
        {
            return false;
        }

        faceplateIndex = int.Parse(faceplateMatch.Groups[1].Value);
        fieldKey = faceplateMatch.Groups[2].Value.ToLowerInvariant();
        return true;
    }

    private static string GetDisplayName(string nodeId)
    {
        var value = nodeId;
        var index = value.IndexOf(";s=", StringComparison.OrdinalIgnoreCase);
        if (index >= 0)
        {
            value = value[(index + 3)..];
        }

        if (value.StartsWith("|var|", StringComparison.OrdinalIgnoreCase))
        {
            value = value[5..];
        }

        var appIndex = value.IndexOf(".Application.", StringComparison.OrdinalIgnoreCase);
        if (appIndex >= 0)
        {
            value = value[(appIndex + ".Application.".Length)..];
        }

        return string.IsNullOrWhiteSpace(value) ? nodeId : value;
    }

    private static bool IsSnapshotOk(TagSnapshotDto snapshot)
    {
        var quality = (snapshot.Quality ?? string.Empty).Trim().ToLowerInvariant();
        var connectionState = (snapshot.ConnectionState ?? string.Empty).Trim().ToLowerInvariant();
        var qualityOk = quality is "" or "good" or "0" or "00000000" or "0000000";
        var connectionOk = connectionState is "" or "connected" or "localstatic";
        return qualityOk && connectionOk;
    }

    private static bool IsHealthySnapshot(TagSnapshotDto snapshot, string? deviceStatus)
    {
        var normalizedDeviceStatus = (deviceStatus ?? string.Empty).Trim().ToLowerInvariant();
        if (normalizedDeviceStatus.Length > 0 && !string.Equals(normalizedDeviceStatus, "connected", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        return IsSnapshotOk(snapshot);
    }

    private static double? ToNumericValue(object? value)
    {
        return value switch
        {
            null => null,
            bool booleanValue => booleanValue ? 1d : 0d,
            byte byteValue => byteValue,
            short shortValue => shortValue,
            int intValue => intValue,
            long longValue => longValue,
            float floatValue when float.IsFinite(floatValue) => floatValue,
            double doubleValue when double.IsFinite(doubleValue) => doubleValue,
            decimal decimalValue => (double)decimalValue,
            string textValue when !string.IsNullOrWhiteSpace(textValue) => TryParseNumeric(textValue),
            _ => null,
        };
    }

    private static double? TryParseNumeric(string value)
    {
        var match = System.Text.RegularExpressions.Regex.Match(value.Replace(",", string.Empty), @"-?\d+(\.\d+)?");
        if (!match.Success)
        {
            return null;
        }

        return double.TryParse(match.Value, out var parsed) ? parsed : null;
    }

    private sealed record FaceplateBoardState(int FaceplateIndex, string StationName, EfficiencyStateKind State);
}

internal static class EfficiencyStateKindExtensions
{
    public static string ToStateKey(this EfficiencyStateKind state)
    {
        return state switch
        {
            EfficiencyStateKind.Standby => "standby",
            EfficiencyStateKind.Running => "running",
            EfficiencyStateKind.Fault => "fault",
            _ => "disconnected",
        };
    }

    public static string ToStateLabel(this EfficiencyStateKind state)
    {
        return state switch
        {
            EfficiencyStateKind.Standby => "待机",
            EfficiencyStateKind.Running => "测试中",
            EfficiencyStateKind.Fault => "报警处理",
            _ => "未工作",
        };
    }

    public static string ToColorHex(this EfficiencyStateKind state)
    {
        return state switch
        {
            EfficiencyStateKind.Standby => "#eace21",
            EfficiencyStateKind.Running => "#2eaa4a",
            EfficiencyStateKind.Fault => "#ca3333",
            _ => "#dadce0",
        };
    }
}
