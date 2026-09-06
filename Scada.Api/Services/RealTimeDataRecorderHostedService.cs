using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;

namespace Scada.Api.Services;

public sealed class RealTimeDataRecorderHostedService : BackgroundService
{
    private static readonly TimeSpan CaptureInterval = TimeSpan.FromMilliseconds(500);
    private static readonly TimeSpan CleanupInterval = TimeSpan.FromHours(1);
    private static readonly Regex FaceplateTagPattern = new(
        @"^HMI_DB\.(?:HMI_Faceplates|Faceplates)\[(?<station>\d+)\]\.(?<field>[^.]+)$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
    private static readonly Regex BarcodeTagPattern = new(
        @"^HMI_DB\.barcode\[(?<station>\d+)\]$",
        RegexOptions.Compiled | RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly TagSnapshotCache _snapshotCache;
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;
    private readonly ILogger<RealTimeDataRecorderHostedService> _logger;
    private DateTime _nextCleanupUtc = DateTime.MinValue;

    public RealTimeDataRecorderHostedService(
        IServiceScopeFactory scopeFactory,
        TagSnapshotCache snapshotCache,
        IScadaRuntimeCoordinator runtimeCoordinator,
        ILogger<RealTimeDataRecorderHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _snapshotCache = snapshotCache;
        _runtimeCoordinator = runtimeCoordinator;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(CaptureInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await CaptureAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Failed to record real-time data snapshot.");
            }

            if (!await timer.WaitForNextTickAsync(stoppingToken))
            {
                break;
            }
        }
    }

    private async Task CaptureAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();

        if (DateTime.UtcNow >= _nextCleanupUtc)
        {
            var cutoff = DateTime.UtcNow.AddMonths(-6);
            await dbContext.RealTimeData
                .Where(item => item.Sj < cutoff)
                .ExecuteDeleteAsync(cancellationToken);
            _nextCleanupUtc = DateTime.UtcNow.Add(CleanupInterval);
        }

        var tags = await dbContext.Tags
            .AsNoTracking()
            .Where(item => item.Enabled)
            .ToListAsync(cancellationToken);
        var snapshots = _snapshotCache.GetAll().ToDictionary(item => item.TagId);
        var rows = new List<RealTimeDataEntity>();
        var capturedAt = DateTime.UtcNow;

        foreach (var stationGroup in tags
                     .Select(tag => (Tag: tag, Station: GetStationOrNull(tag.DisplayName)))
                     .Where(item => item.Station is not null)
                     .GroupBy(item => new { item.Tag.DeviceId, Station = item.Station!.Value }))
        {
            if (!_runtimeCoordinator.IsConnectionHealthy(stationGroup.Key.DeviceId))
            {
                continue;
            }

            var values = stationGroup
                .Select(item => (Field: GetFieldName(item.Tag.DisplayName), Snapshot: snapshots.GetValueOrDefault(item.Tag.Id)))
                .Where(item => item.Snapshot is not null && IsGoodSnapshot(item.Snapshot!, capturedAt))
                .ToDictionary(item => item.Field, item => item.Snapshot!, StringComparer.OrdinalIgnoreCase);

            if (values.Count == 0)
            {
                continue;
            }

            rows.Add(new RealTimeDataEntity
            {
                Sj = capturedAt,
                Gw = stationGroup.Key.Station,
                OrderNo = ReadString(values, "barcode"),
                Model = ReadString(values, "model"),
                Voltage = ReadDouble(values, "voltage"),
                Frequency = ReadDouble(values, "frequency"),
                Current = ReadDouble(values, "current"),
                Power = ReadDouble(values, "power"),
                PowerFactor = ReadDouble(values, "powerFactor"),
                Pressure = ReadDouble(values, "pressure"),
                Flow = ReadDouble(values, "flow"),
                Siphon = ReadDouble(values, "siphon"),
                InletTemp = ReadDouble(values, "inletTemp"),
                Speed = ReadDouble(values, "speed")
            });
        }

        if (rows.Count == 0)
        {
            return;
        }

        dbContext.RealTimeData.AddRange(rows);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private static bool TryGetStation(string displayName, out int station)
    {
        var match = FaceplateTagPattern.Match(displayName);
        if (!match.Success)
        {
            match = BarcodeTagPattern.Match(displayName);
        }

        if (!match.Success || !int.TryParse(match.Groups["station"].Value, out station))
        {
            station = 0;
            return false;
        }

        return station > 0;
    }

    private static int? GetStationOrNull(string displayName)
    {
        return TryGetStation(displayName, out var station) ? station : null;
    }

    private static string GetFieldName(string displayName)
    {
        var faceplateMatch = FaceplateTagPattern.Match(displayName);
        if (faceplateMatch.Success)
        {
            return faceplateMatch.Groups["field"].Value;
        }

        return "barcode";
    }

    private static bool IsGoodSnapshot(TagSnapshotDto snapshot, DateTime capturedAt)
    {
        if (!snapshot.Quality.Equals("Good", StringComparison.OrdinalIgnoreCase) &&
            !snapshot.Quality.Equals("GoodNoData", StringComparison.OrdinalIgnoreCase))
        {
            return false;
        }

        var timestamp = snapshot.ServerTimestamp ?? snapshot.SourceTimestamp;
        return timestamp is { } &&
               timestamp.Value.UtcDateTime >= capturedAt.AddSeconds(-2) &&
               timestamp.Value.UtcDateTime <= capturedAt.AddSeconds(2);
    }

    private static string? ReadString(IReadOnlyDictionary<string, TagSnapshotDto> values, string field)
    {
        if (!values.TryGetValue(field, out var snapshot) || snapshot.Value is null)
        {
            return null;
        }

        return snapshot.Value switch
        {
            JsonElement json when json.ValueKind == JsonValueKind.String => json.GetString(),
            _ => Convert.ToString(snapshot.Value, CultureInfo.InvariantCulture)
        };
    }

    private static double? ReadDouble(IReadOnlyDictionary<string, TagSnapshotDto> values, string field)
    {
        if (!values.TryGetValue(field, out var snapshot) || snapshot.Value is null)
        {
            return null;
        }

        if (snapshot.Value is JsonElement json)
        {
            if (json.ValueKind == JsonValueKind.Number && json.TryGetDouble(out var number))
            {
                return number;
            }

            if (json.ValueKind == JsonValueKind.String && double.TryParse(json.GetString(), NumberStyles.Float, CultureInfo.InvariantCulture, out number))
            {
                return number;
            }

            return null;
        }

        try
        {
            return Convert.ToDouble(snapshot.Value, CultureInfo.InvariantCulture);
        }
        catch (FormatException)
        {
            return null;
        }
        catch (InvalidCastException)
        {
            return null;
        }
    }
}
