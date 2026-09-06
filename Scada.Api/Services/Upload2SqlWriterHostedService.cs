using System.Data;
using System.Globalization;
using System.Text.Json;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;

namespace Scada.Api.Services;

public sealed class Upload2SqlWriterHostedService : BackgroundService
{
    private const int DefaultStationCount = 4;

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;
    private readonly TagSnapshotCache _snapshotCache;
    private readonly ILogger<Upload2SqlWriterHostedService> _logger;
    private readonly string _connectionString;
    private readonly Dictionary<int, bool?> _lastUpdateState = [];
    private readonly Dictionary<int, bool?> _lastUpdateErrState = [];

    public Upload2SqlWriterHostedService(
        IConfiguration configuration,
        IServiceScopeFactory scopeFactory,
        IScadaRuntimeCoordinator runtimeCoordinator,
        TagSnapshotCache snapshotCache,
        ILogger<Upload2SqlWriterHostedService> logger)
    {
        _connectionString = configuration.GetConnectionString("MssqlRecordDb")
            ?? throw new InvalidOperationException("Missing connection string: MssqlRecordDb");
        _scopeFactory = scopeFactory;
        _runtimeCoordinator = runtimeCoordinator;
        _snapshotCache = snapshotCache;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await Task.Delay(TimeSpan.FromSeconds(3), stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await ProcessOnceAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Upload2SQL writer loop failed.");
            }

            await Task.Delay(TimeSpan.FromMilliseconds(500), stoppingToken);
        }
    }

    private async Task ProcessOnceAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
        var stations = await ResolveStationsAsync(dbContext, cancellationToken);
        var tags = await dbContext.Tags
            .Include(tag => tag.Device)
            .Where(tag => tag.Enabled)
            .ToListAsync(cancellationToken);

        var lookup = UploadTagLookup.Build(tags, stations);
        foreach (var station in stations)
        {
            await ProcessRecordTriggerAsync(dbContext, station, lookup, cancellationToken);
            await ProcessErrorTriggerAsync(dbContext, station, lookup, cancellationToken);
        }
    }

    private static async Task<UploadStationDefinition[]> ResolveStationsAsync(ScadaDbContext dbContext, CancellationToken cancellationToken)
    {
        var value = await dbContext.SystemSettings
            .AsNoTracking()
            .Where(item => item.Key == "StationCount")
            .Select(item => item.Value)
            .FirstOrDefaultAsync(cancellationToken);

        var stationCount = NormalizeStationCount(value);
        return Enumerable.Range(1, stationCount)
            .Select(index => new UploadStationDefinition(index, $"IFA_Updata{index}"))
            .ToArray();
    }

    private static int NormalizeStationCount(string? value)
    {
        return int.TryParse(value, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsed)
            ? Math.Clamp(parsed, 1, 64)
            : DefaultStationCount;
    }

    private async Task ProcessRecordTriggerAsync(ScadaDbContext dbContext, UploadStationDefinition station, UploadTagLookup lookup, CancellationToken cancellationToken)
    {
        var triggerTag = lookup.GetUploadTag(station.Index, "update");
        var currentState = ReadHealthyBool(triggerTag);
        if (IsRisingEdge(_lastUpdateState, station.Index, currentState))
        {
            try
            {
                await InsertRecordAsync(station, lookup, cancellationToken);
                await ResetTriggerAsync(triggerTag, cancellationToken);
                await AddInsertAuditAsync(dbContext, station, "Update", "dbo.Record", triggerTag, lookup, cancellationToken);
                _lastUpdateState[station.Index] = false;
                _logger.LogInformation("Upload2SQL[{Index}] Record inserted and update reset.", station.Index);
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to insert dbo.Record for Upload2SQL[{Index}].", station.Index);
                return;
            }
        }

        _lastUpdateState[station.Index] = currentState;
    }

    private async Task ProcessErrorTriggerAsync(ScadaDbContext dbContext, UploadStationDefinition station, UploadTagLookup lookup, CancellationToken cancellationToken)
    {
        var triggerTag = lookup.GetUploadTag(station.Index, "updateErr");
        var currentState = ReadHealthyBool(triggerTag);
        if (IsRisingEdge(_lastUpdateErrState, station.Index, currentState))
        {
            try
            {
                await InsertErrorAsync(station, lookup, cancellationToken);
                await ResetTriggerAsync(triggerTag, cancellationToken);
                await AddInsertAuditAsync(dbContext, station, "UpdateErr", "dbo.Error", triggerTag, lookup, cancellationToken);
                _lastUpdateErrState[station.Index] = false;
                _logger.LogInformation("Upload2SQL[{Index}] Error inserted and updateErr reset.", station.Index);
                return;
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Failed to insert dbo.Error for Upload2SQL[{Index}].", station.Index);
                return;
            }
        }

        _lastUpdateErrState[station.Index] = currentState;
    }

    private async Task InsertRecordAsync(UploadStationDefinition station, UploadTagLookup lookup, CancellationToken cancellationToken)
    {
        const string sql = """
            INSERT INTO dbo.Record(
                orderNo, mode, ry, tm, gw, model,
                inletTemp, inletPressure, lowVoltage, lowCurrent, voltage, frequency, [current],
                power, powerFactor, unloadSpeed, loadSpeed, pressure, holdingPressure, recoilPressure,
                flow, siphon, triggerCount, lastTimeHour, lastTimeMinute, roomtemp, roomwet)
            VALUES(
                @orderNo, @mode, @ry, @tm, @gw, @model,
                @inletTemp, @inletPressure, @lowVoltage, @lowCurrent, @voltage, @frequency, @current,
                @power, @powerFactor, @unloadSpeed, @loadSpeed, @pressure, @holdingPressure, @recoilPressure,
                @flow, @siphon, @triggerCount, @lastTimeHour, @lastTimeMinute, @roomtemp, @roomwet);
            """;

        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(sql, connection);

        AddString(command, "@orderNo", ReadString(lookup.GetLocalTag($"OrderNo[{station.Index}]")), 50);
        AddInt(command, "@mode", ReadInt(lookup.GetUploadTag(station.Index, "Record.mode")));
        AddString(command, "@ry", ReadString(lookup.GetLocalTag($"ry[{station.Index}]")), 50);
        AddString(command, "@tm", ReadString(lookup.GetUploadTag(station.Index, "tm")), 50);
        AddInt(command, "@gw", ReadInt(lookup.GetUploadTag(station.Index, "gw")));
        AddString(command, "@model", await ReadRecipeNameAsync(lookup, station.Index, cancellationToken), 50);
        AddDouble(command, "@inletTemp", ReadDouble(lookup.GetUploadTag(station.Index, "Record.inletTemp")));
        AddDouble(command, "@inletPressure", ReadDouble(lookup.GetUploadTag(station.Index, "Record.inletPressure")));
        AddDouble(command, "@lowVoltage", ReadDouble(lookup.GetUploadTag(station.Index, "Record.lowVoltage")));
        AddDouble(command, "@lowCurrent", ReadDouble(lookup.GetUploadTag(station.Index, "Record.lowCurrent")));
        AddDouble(command, "@voltage", ReadDouble(lookup.GetUploadTag(station.Index, "Record.voltage")));
        AddDouble(command, "@frequency", ReadDouble(lookup.GetUploadTag(station.Index, "Record.frequency")));
        AddDouble(command, "@current", ReadDouble(lookup.GetUploadTag(station.Index, "Record.current")));
        AddDouble(command, "@power", ReadDouble(lookup.GetUploadTag(station.Index, "Record.power")));
        AddDouble(command, "@powerFactor", ReadDouble(lookup.GetUploadTag(station.Index, "Record.powerFactor")));
        AddDouble(command, "@unloadSpeed", ReadDouble(lookup.GetUploadTag(station.Index, "Record.unloadSpeed")));
        AddDouble(command, "@loadSpeed", ReadDouble(lookup.GetUploadTag(station.Index, "Record.loadSpeed")));
        AddDouble(command, "@pressure", ReadDouble(lookup.GetUploadTag(station.Index, "Record.pressure")));
        AddDouble(command, "@holdingPressure", ReadDouble(lookup.GetUploadTag(station.Index, "Record.holdingPressure")));
        AddDouble(command, "@recoilPressure", ReadDouble(lookup.GetUploadTag(station.Index, "Record.recoilPressure")));
        AddDouble(command, "@flow", ReadDouble(lookup.GetUploadTag(station.Index, "Record.flow")));
        AddDouble(command, "@siphon", ReadDouble(lookup.GetUploadTag(station.Index, "Record.siphon")));
        AddInt(command, "@triggerCount", ReadInt(lookup.GetUploadTag(station.Index, "Record.triggerCount")));
        AddInt(command, "@lastTimeHour", ReadInt(lookup.GetUploadTag(station.Index, "Record.lastTimeHour")));
        AddInt(command, "@lastTimeMinute", ReadInt(lookup.GetUploadTag(station.Index, "Record.lastTimeMinute")));
        AddDouble(command, "@roomtemp", ReadDouble(lookup.GetLocalTag("Local.roomtemp")));
        AddDouble(command, "@roomwet", ReadDouble(lookup.GetLocalTag("Local.roomwet")));

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task InsertErrorAsync(UploadStationDefinition station, UploadTagLookup lookup, CancellationToken cancellationToken)
    {
        const string sql = """
            INSERT INTO dbo.Error(mode, ry, tm, gw, model, ERR, [current], pressure, flow, speed)
            VALUES(@mode, @ry, @tm, @gw, @model, @err, @current, @pressure, @flow, @speed);
            """;

        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(sql, connection);

        AddInt(command, "@mode", ReadInt(lookup.GetUploadTag(station.Index, "Record.mode")));
        AddString(command, "@ry", ReadString(lookup.GetLocalTag($"ry[{station.Index}]")), 50);
        AddString(command, "@tm", ReadString(lookup.GetUploadTag(station.Index, "tm")), 50);
        AddInt(command, "@gw", ReadInt(lookup.GetUploadTag(station.Index, "gw")));
        AddString(command, "@model", await ReadRecipeNameAsync(lookup, station.Index, cancellationToken), 50);
        AddInt(command, "@err", ReadInt(lookup.GetUploadTag(station.Index, "RecordErr.errCode")));
        AddFloat(command, "@current", ReadDouble(lookup.GetUploadTag(station.Index, "RecordErr.current")));
        AddFloat(command, "@pressure", ReadDouble(lookup.GetUploadTag(station.Index, "RecordErr.pressure")));
        AddFloat(command, "@flow", ReadDouble(lookup.GetUploadTag(station.Index, "RecordErr.flow")));
        AddFloat(command, "@speed", ReadDouble(lookup.GetUploadTag(station.Index, "RecordErr.speed")));

        await command.ExecuteNonQueryAsync(cancellationToken);
    }

    private async Task AddInsertAuditAsync(
        ScadaDbContext dbContext,
        UploadStationDefinition station,
        string triggerKind,
        string targetTable,
        TagDefinitionEntity? triggerTag,
        UploadTagLookup lookup,
        CancellationToken cancellationToken)
    {
        var now = DateTimeOffset.UtcNow;
        dbContext.UploadInsertAudits.Add(new UploadInsertAuditEntity
        {
            StationIndex = station.Index,
            TriggerKind = triggerKind,
            TargetTable = targetTable,
            DisplayName = triggerTag?.DisplayName ?? $"Upload2SQL[{station.Index}].{triggerKind}",
            Tm = ReadString(lookup.GetUploadTag(station.Index, "tm")),
            Gw = ReadInt(lookup.GetUploadTag(station.Index, "gw")),
            OrderNo = ReadString(lookup.GetLocalTag($"OrderNo[{station.Index}]")),
            Mode = ReadInt(lookup.GetUploadTag(station.Index, "Record.mode")),
            CreatedAt = now,
        });

        await dbContext.UploadInsertAudits
            .Where(item => item.CreatedAt < now.AddMonths(-1))
            .ExecuteDeleteAsync(cancellationToken);
        await dbContext.SaveChangesAsync(cancellationToken);
    }

    private async Task ResetTriggerAsync(TagDefinitionEntity? triggerTag, CancellationToken cancellationToken)
    {
        if (triggerTag?.Device is null)
        {
            return;
        }

        var value = JsonSerializer.SerializeToElement(false);
        var result = await _runtimeCoordinator.WriteAsync(triggerTag.Device, triggerTag, value, cancellationToken);
        if (!result.Succeeded)
        {
            throw new InvalidOperationException($"Failed to reset trigger {triggerTag.DisplayName}: {result.ErrorMessage ?? result.StatusCode}");
        }
    }

    private bool? ReadHealthyBool(TagDefinitionEntity? tag)
    {
        var snapshot = ReadHealthySnapshot(tag);
        return snapshot is null ? null : TryConvertBool(snapshot.Value);
    }

    private string? ReadString(TagDefinitionEntity? tag)
    {
        var value = ReadHealthySnapshot(tag)?.Value;
        return value switch
        {
            null => null,
            JsonElement { ValueKind: JsonValueKind.String } element => element.GetString(),
            JsonElement { ValueKind: JsonValueKind.Null } => null,
            JsonElement element => element.ToString(),
            _ => Convert.ToString(value, CultureInfo.InvariantCulture)
        };
    }

    private async Task<string?> ReadStringWithRetryAsync(TagDefinitionEntity? tag, CancellationToken cancellationToken)
    {
        for (var attempt = 0; attempt < 10; attempt++)
        {
            var value = ReadString(tag);
            if (!string.IsNullOrWhiteSpace(value))
            {
                return value;
            }

            await Task.Delay(200, cancellationToken);
        }

        return ReadString(tag);
    }

    private async Task<string?> ReadRecipeNameAsync(UploadTagLookup lookup, int stationIndex, CancellationToken cancellationToken)
    {
        var recipeName = await ReadStringWithRetryAsync(lookup.GetRecipeNameTag(stationIndex), cancellationToken);
        if (!string.IsNullOrWhiteSpace(recipeName))
        {
            return recipeName;
        }

        recipeName = await ReadStringWithRetryAsync(lookup.GetLocalTag($"Local.RecipeName[{stationIndex}]"), cancellationToken);
        if (!string.IsNullOrWhiteSpace(recipeName))
        {
            return recipeName;
        }

        recipeName = await ReadStringWithRetryAsync(lookup.GetLocalTag("Local.RecipeName"), cancellationToken);
        return string.IsNullOrWhiteSpace(recipeName) ? null : recipeName;
    }

    private int? ReadInt(TagDefinitionEntity? tag)
    {
        var numeric = ReadDouble(tag);
        return numeric.HasValue ? Convert.ToInt32(Math.Round(numeric.Value, MidpointRounding.AwayFromZero)) : null;
    }

    private double? ReadDouble(TagDefinitionEntity? tag)
    {
        var value = ReadHealthySnapshot(tag)?.Value;
        return TryConvertDouble(value);
    }

    private TagSnapshotDto? ReadHealthySnapshot(TagDefinitionEntity? tag)
    {
        if (tag is null)
        {
            return null;
        }

        var snapshot = _snapshotCache.Get(tag.Id);
        return snapshot is not null && IsSnapshotHealthy(snapshot) ? snapshot : null;
    }

    private static bool IsRisingEdge(Dictionary<int, bool?> stateByIndex, int index, bool? currentState)
    {
        var previousState = stateByIndex.TryGetValue(index, out var previous) ? previous : false;
        return currentState == true && previous != true;
    }

    private static bool IsSnapshotHealthy(TagSnapshotDto snapshot)
    {
        var quality = snapshot.Quality?.Trim() ?? string.Empty;
        return quality.Equals("Good", StringComparison.OrdinalIgnoreCase) ||
               quality.Equals("00000000", StringComparison.OrdinalIgnoreCase) ||
               quality.Equals("True", StringComparison.OrdinalIgnoreCase) ||
               quality.Equals("OK", StringComparison.OrdinalIgnoreCase);
    }

    private static bool? TryConvertBool(object? value)
    {
        return value switch
        {
            null => null,
            bool boolValue => boolValue,
            JsonElement { ValueKind: JsonValueKind.True } => true,
            JsonElement { ValueKind: JsonValueKind.False } => false,
            JsonElement { ValueKind: JsonValueKind.Number } element when element.TryGetDouble(out var number) => Math.Abs(number) > double.Epsilon,
            JsonElement { ValueKind: JsonValueKind.String } element => TryConvertBool(element.GetString()),
            string text when bool.TryParse(text, out var parsedBool) => parsedBool,
            string text when double.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsedNumber) => Math.Abs(parsedNumber) > double.Epsilon,
            IConvertible convertible => TryConvertConvertibleDouble(convertible) is { } number && Math.Abs(number) > double.Epsilon,
            _ => null
        };
    }

    private static double? TryConvertDouble(object? value)
    {
        return value switch
        {
            null => null,
            JsonElement { ValueKind: JsonValueKind.Number } element when element.TryGetDouble(out var number) => number,
            JsonElement { ValueKind: JsonValueKind.String } element => TryConvertDouble(element.GetString()),
            JsonElement { ValueKind: JsonValueKind.True } => 1d,
            JsonElement { ValueKind: JsonValueKind.False } => 0d,
            string text when double.TryParse(text, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed) => parsed,
            IConvertible convertible => TryConvertConvertibleDouble(convertible),
            _ => null
        };
    }

    private static double? TryConvertConvertibleDouble(IConvertible value)
    {
        try
        {
            return value.ToDouble(CultureInfo.InvariantCulture);
        }
        catch
        {
            return null;
        }
    }

    private static void AddString(SqlCommand command, string name, string? value, int size)
    {
        command.Parameters.Add(new SqlParameter(name, SqlDbType.VarChar, size) { Value = string.IsNullOrEmpty(value) ? DBNull.Value : value });
    }

    private static void AddInt(SqlCommand command, string name, int? value)
    {
        command.Parameters.Add(new SqlParameter(name, SqlDbType.Int) { Value = value.HasValue ? value.Value : DBNull.Value });
    }

    private static void AddDouble(SqlCommand command, string name, double? value)
    {
        command.Parameters.Add(new SqlParameter(name, SqlDbType.Float) { Value = value.HasValue ? value.Value : DBNull.Value });
    }

    private static void AddFloat(SqlCommand command, string name, double? value)
    {
        command.Parameters.Add(new SqlParameter(name, SqlDbType.Real) { Value = value.HasValue ? Convert.ToSingle(value.Value) : DBNull.Value });
    }

    private sealed record UploadStationDefinition(int Index, string GroupKey);

    private sealed class UploadTagLookup
    {
        private readonly Dictionary<string, TagDefinitionEntity> _uploadTags;
        private readonly Dictionary<string, TagDefinitionEntity> _localTags;
        private readonly Dictionary<string, TagDefinitionEntity> _recipeNameTags;

        private UploadTagLookup(
            Dictionary<string, TagDefinitionEntity> uploadTags,
            Dictionary<string, TagDefinitionEntity> localTags,
            Dictionary<string, TagDefinitionEntity> recipeNameTags)
        {
            _uploadTags = uploadTags;
            _localTags = localTags;
            _recipeNameTags = recipeNameTags;
        }

        public static UploadTagLookup Build(IEnumerable<TagDefinitionEntity> tags, IEnumerable<UploadStationDefinition> stations)
        {
            var uploadTags = new Dictionary<string, TagDefinitionEntity>(StringComparer.OrdinalIgnoreCase);
            var localTags = new Dictionary<string, TagDefinitionEntity>(StringComparer.OrdinalIgnoreCase);
            var recipeNameTags = new Dictionary<string, TagDefinitionEntity>(StringComparer.OrdinalIgnoreCase);
            var stationDefinitions = stations.ToArray();

            foreach (var tag in tags)
            {
                foreach (var station in stationDefinitions)
                {
                    var prefix = $"Upload2SQL[{station.Index}].";
                    if (string.Equals(tag.GroupKey, station.GroupKey, StringComparison.OrdinalIgnoreCase) &&
                        tag.DisplayName.StartsWith(prefix, StringComparison.OrdinalIgnoreCase))
                    {
                        uploadTags[$"{station.Index}:{tag.DisplayName[prefix.Length..]}"] = tag;
                    }
                }

                if (string.Equals(tag.GroupKey, "Local", StringComparison.OrdinalIgnoreCase))
                {
                    localTags[tag.DisplayName] = tag;
                }

                var recipePrefix = "Recipe_DB.RecipeName[";
                if (tag.DisplayName.StartsWith(recipePrefix, StringComparison.OrdinalIgnoreCase) &&
                    tag.DisplayName.EndsWith("]", StringComparison.Ordinal))
                {
                    var indexText = tag.DisplayName[recipePrefix.Length..^1];
                    if (int.TryParse(indexText, NumberStyles.Integer, CultureInfo.InvariantCulture, out var recipeIndex))
                    {
                        recipeNameTags[recipeIndex.ToString(CultureInfo.InvariantCulture)] = tag;
                    }
                }
            }

            return new UploadTagLookup(uploadTags, localTags, recipeNameTags);
        }

        public TagDefinitionEntity? GetUploadTag(int index, string fieldKey)
        {
            return _uploadTags.GetValueOrDefault($"{index}:{fieldKey}");
        }

        public TagDefinitionEntity? GetLocalTag(string displayName)
        {
            return _localTags.GetValueOrDefault(displayName);
        }

        public TagDefinitionEntity? GetRecipeNameTag(int index)
        {
            return _recipeNameTags.GetValueOrDefault(index.ToString(CultureInfo.InvariantCulture));
        }
    }
}
