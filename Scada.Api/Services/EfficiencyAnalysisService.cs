using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;

namespace Scada.Api.Services;

public interface IEfficiencyAnalysisService
{
    Task CaptureCurrentStateAsync(CancellationToken cancellationToken);
    Task<EfficiencyTimelineResponseDto> GetTimelineAsync(int hours, CancellationToken cancellationToken);
}

public sealed class EfficiencyAnalysisService : IEfficiencyAnalysisService
{
    private static readonly int[] FaceplateIndexes = [1, 2];
    private static readonly TimeSpan DataRetention = TimeSpan.FromDays(7);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;
    private readonly ILogger<EfficiencyAnalysisService> _logger;
    private readonly SemaphoreSlim _syncLock = new(1, 1);

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
            await CaptureLiveStateInternalAsync(dbContext, now, cancellationToken);
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

    public async Task<EfficiencyTimelineResponseDto> GetTimelineAsync(int hours, CancellationToken cancellationToken)
    {
        var clampedHours = Math.Clamp(hours, 1, 72);
        await _syncLock.WaitAsync(cancellationToken);
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
            var windowEnd = DateTimeOffset.UtcNow;
            var windowStart = windowEnd.AddHours(-clampedHours);

            await CaptureLiveStateInternalAsync(dbContext, windowEnd, cancellationToken);
            await CleanupOldSegmentsAsync(dbContext, windowEnd, cancellationToken);
            if (dbContext.ChangeTracker.HasChanges())
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }

            var segments = await dbContext.EfficiencyTimelineSegments
                .AsNoTracking()
                .Where(item => FaceplateIndexes.Contains(item.FaceplateIndex))
                .ToListAsync(cancellationToken);

            segments = segments
                .Where(item => !item.IsDemo && item.EndedAt >= windowStart && item.StartedAt <= windowEnd)
                .OrderBy(item => item.FaceplateIndex)
                .ThenBy(item => item.StartedAt)
                .ToList();

            var lanes = FaceplateIndexes.Select(faceplateIndex =>
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

                var latestState = laneSegments.LastOrDefault();
                return new EfficiencyTimelineLaneDto(
                    faceplateIndex,
                    latestState?.StationName ?? $"工位{faceplateIndex}",
                    latestState?.StateKey ?? EfficiencyStateKind.Disconnected.ToStateKey(),
                    latestState?.StateLabel ?? EfficiencyStateKind.Disconnected.ToStateLabel(),
                    latestState?.ColorHex ?? EfficiencyStateKind.Disconnected.ToColorHex(),
                    laneSegments);
            }).ToArray();

            return new EfficiencyTimelineResponseDto(windowStart, windowEnd, DateTimeOffset.UtcNow, lanes);
        }
        finally
        {
            _syncLock.Release();
        }
    }

    private async Task CaptureLiveStateInternalAsync(ScadaDbContext dbContext, DateTimeOffset now, CancellationToken cancellationToken)
    {
        try
        {
            var overview = await _runtimeCoordinator.GetRuntimeOverviewAsync(cancellationToken);
            foreach (var state in BuildCurrentBoardStates(overview))
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
        foreach (var faceplateIndex in FaceplateIndexes)
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
        var latestSegment = (await dbContext.EfficiencyTimelineSegments
            .Where(item => item.FaceplateIndex == state.FaceplateIndex)
            .ToListAsync(cancellationToken))
            .OrderByDescending(item => item.EndedAt)
            .ThenByDescending(item => item.StartedAt)
            .FirstOrDefault();

        if (latestSegment is null)
        {
            dbContext.EfficiencyTimelineSegments.Add(new EfficiencyTimelineSegmentEntity
            {
                FaceplateIndex = state.FaceplateIndex,
                StationName = state.StationName,
                State = state.State,
                StartedAt = now.AddSeconds(-1),
                EndedAt = now,
                UpdatedAt = now,
                IsDemo = false,
            });
            return;
        }

        if (latestSegment.EndedAt > now)
        {
            latestSegment.EndedAt = now;
        }

        if (latestSegment.State == state.State)
        {
            latestSegment.StationName = state.StationName;
            latestSegment.EndedAt = now;
            latestSegment.UpdatedAt = now;
            latestSegment.IsDemo = false;
            return;
        }

        latestSegment.EndedAt = now;
        latestSegment.UpdatedAt = now;

        dbContext.EfficiencyTimelineSegments.Add(new EfficiencyTimelineSegmentEntity
        {
            FaceplateIndex = state.FaceplateIndex,
            StationName = state.StationName,
            State = state.State,
            StartedAt = now,
            EndedAt = now,
            UpdatedAt = now,
            IsDemo = false,
        });
    }

    private async Task CleanupOldSegmentsAsync(ScadaDbContext dbContext, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var cutoff = now - DataRetention;
        var expiredSegments = (await dbContext.EfficiencyTimelineSegments
            .ToListAsync(cancellationToken))
            .Where(item => item.EndedAt < cutoff)
            .ToList();

        if (expiredSegments.Count > 0)
        {
            dbContext.EfficiencyTimelineSegments.RemoveRange(expiredSegments);
        }
    }

    private static List<EfficiencyTimelineSegmentEntity> BuildDemoSegments(
        int faceplateIndex,
        string stationName,
        DateTimeOffset windowStart,
        DateTimeOffset windowEnd)
    {
        var plan = faceplateIndex == 1
            ? new (EfficiencyStateKind State, int Minutes)[]
            {
                (EfficiencyStateKind.Disconnected, 56),
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
                (EfficiencyStateKind.Disconnected, 30),
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

    private static IEnumerable<FaceplateBoardState> BuildCurrentBoardStates(RuntimeOverviewDto overview)
    {
        var snapshotByTagId = overview.Snapshots.ToDictionary(item => item.TagId, item => item);
        var deviceStatusById = overview.Devices.ToDictionary(item => item.DeviceId, item => item.Status);

        foreach (var faceplateIndex in FaceplateIndexes)
        {
            var faceplateTags = overview.Tags
                .Where(tag =>
                {
                    var displayName = GetDisplayName(tag.NodeId);
                    return displayName.StartsWith($"HMI_DB.HMI_Faceplates[{faceplateIndex}].", StringComparison.OrdinalIgnoreCase)
                        || displayName.StartsWith($"HMI_DB.Faceplates[{faceplateIndex}].", StringComparison.OrdinalIgnoreCase)
                        || displayName.Equals($"HMI_DB.barcode[{faceplateIndex}]", StringComparison.OrdinalIgnoreCase);
                })
                .ToArray();

            if (faceplateTags.Length == 0)
            {
                // Keep timeline aligned with dashboard fallback: no matching tags => disconnected.
                yield return new FaceplateBoardState(faceplateIndex, $"宸ヤ綅{faceplateIndex}", EfficiencyStateKind.Disconnected);
                continue;
            }

            var stationNumber = ReadNumericValue(faceplateTags, faceplateIndex, snapshotByTagId, "stationnumber");
            var workflow = ReadNumericValue(faceplateTags, faceplateIndex, snapshotByTagId, "workflow");
            var errCode = ReadNumericValue(faceplateTags, faceplateIndex, snapshotByTagId, "errcode");
            var hasConnectedDevice = faceplateTags.Any(tag =>
                deviceStatusById.TryGetValue(tag.DeviceId, out var status) && string.Equals(status, "connected", StringComparison.OrdinalIgnoreCase));
            var hasGoodSnapshot = faceplateTags.Any(tag =>
                snapshotByTagId.TryGetValue(tag.Id, out var snapshot) && IsOpcUaSnapshotOk(snapshot));
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

    private static string ShortLabelForFaceplate(TagDefinitionDto tag, int faceplateIndex)
    {
        var displayName = GetDisplayName(tag.NodeId);
        var prefixes = new[]
        {
            $"HMI_DB.HMI_Faceplates[{faceplateIndex}].",
            $"HMI_DB.Faceplates[{faceplateIndex}].",
        };

        foreach (var prefix in prefixes)
        {
            if (displayName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
            {
                return displayName[prefix.Length..];
            }
        }

        return displayName.Equals($"HMI_DB.barcode[{faceplateIndex}]", StringComparison.OrdinalIgnoreCase)
            ? "barcode"
            : displayName;
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

    private static bool IsOpcUaSnapshotOk(TagSnapshotDto snapshot)
    {
        var quality = (snapshot.Quality ?? string.Empty).Trim().ToLowerInvariant();
        var connectionState = (snapshot.ConnectionState ?? string.Empty).Trim().ToLowerInvariant();
        var qualityOk = quality is "" or "good" or "0" or "00000000" or "0000000";
        var connectionOk = connectionState is "" or "connected";
        return qualityOk && connectionOk;
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
