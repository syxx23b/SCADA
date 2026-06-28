using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/system-settings")]
public sealed class SystemSettingsController : ControllerBase
{
    private static readonly string[] PressureUnits = ["MPa", "PSI", "bar"];
    private static readonly string[] FlowUnits = ["L/M", "m³/h", "GPM"];

    private readonly ScadaDbContext _dbContext;

    public SystemSettingsController(ScadaDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    public async Task<ActionResult<SystemSettingsResponseDto>> Get(CancellationToken cancellationToken)
    {
        var settings = await EnsureSettingsAsync(cancellationToken);
        return Ok(ToResponse(settings));
    }

    [HttpPut]
    public async Task<ActionResult<SystemSettingsResponseDto>> Update([FromBody] UpdateSystemSettingsRequestDto request, CancellationToken cancellationToken)
    {
        var settings = await EnsureSettingsAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;

        UpsertSetting(settings, "StationCount", NormalizeStationCount(request.StationCount).ToString(), now);
        UpsertSetting(settings, "PressureUnit", NormalizeUnit(request.PressureUnit, PressureUnits, "MPa"), now);
        UpsertSetting(settings, "FlowUnit", NormalizeUnit(request.FlowUnit, FlowUnits, "L/M"), now);

        await _dbContext.SaveChangesAsync(cancellationToken);
        return Ok(ToResponse(settings));
    }

    private async Task<Dictionary<string, SystemSettingEntity>> EnsureSettingsAsync(CancellationToken cancellationToken)
    {
        var settings = await _dbContext.SystemSettings.ToDictionaryAsync(item => item.Key, StringComparer.OrdinalIgnoreCase, cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var changed = false;

        changed |= EnsureDefault(settings, "StationCount", "4", now);
        changed |= EnsureDefault(settings, "PressureUnit", "MPa", now);
        changed |= EnsureDefault(settings, "FlowUnit", "L/M", now);

        if (changed)
        {
            await _dbContext.SaveChangesAsync(cancellationToken);
        }

        return settings;
    }

    private bool EnsureDefault(Dictionary<string, SystemSettingEntity> settings, string key, string value, DateTimeOffset now)
    {
        if (settings.ContainsKey(key))
        {
            return false;
        }

        var entity = new SystemSettingEntity
        {
            Key = key,
            Value = value,
            UpdatedAt = now,
        };
        _dbContext.SystemSettings.Add(entity);
        settings[key] = entity;
        return true;
    }

    private static void UpsertSetting(Dictionary<string, SystemSettingEntity> settings, string key, string value, DateTimeOffset now)
    {
        if (settings.TryGetValue(key, out var entity))
        {
            entity.Value = value;
            entity.UpdatedAt = now;
        }
    }

    private static SystemSettingsResponseDto ToResponse(Dictionary<string, SystemSettingEntity> settings)
    {
        var stationCount = NormalizeStationCount(ParseInt(settings, "StationCount", 4));
        var pressureUnit = NormalizeUnit(ParseString(settings, "PressureUnit", "MPa"), PressureUnits, "MPa");
        var flowUnit = NormalizeUnit(ParseString(settings, "FlowUnit", "L/M"), FlowUnits, "L/M");
        return new SystemSettingsResponseDto(stationCount, pressureUnit, flowUnit);
    }

    private static int ParseInt(Dictionary<string, SystemSettingEntity> settings, string key, int fallback)
    {
        return settings.TryGetValue(key, out var entity) && int.TryParse(entity.Value, out var parsed)
            ? parsed
            : fallback;
    }

    private static string ParseString(Dictionary<string, SystemSettingEntity> settings, string key, string fallback)
    {
        return settings.TryGetValue(key, out var entity) && !string.IsNullOrWhiteSpace(entity.Value)
            ? entity.Value
            : fallback;
    }

    private static int NormalizeStationCount(int value)
    {
        if (value < 1) return 1;
        if (value > 64) return 64;
        return value;
    }

    private static string NormalizeUnit(string? value, string[] allowedUnits, string fallback)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return fallback;
        }

        return allowedUnits.FirstOrDefault(item => item.Equals(normalized, StringComparison.OrdinalIgnoreCase)) ?? fallback;
    }
}

public sealed record SystemSettingsResponseDto(
    int StationCount,
    string PressureUnit,
    string FlowUnit);

public sealed record UpdateSystemSettingsRequestDto(
    int StationCount,
    string PressureUnit,
    string FlowUnit);
