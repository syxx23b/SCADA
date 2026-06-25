using System.Text.Json.Serialization;
using Scada.Api.Domain;

namespace Scada.Api.Dtos;

public sealed record DeviceConnectionDto(
    Guid Id,
    string Name,
    string DriverKind,
    string EndpointUrl,
    string SecurityMode,
    string SecurityPolicy,
    string AuthMode,
    string? Username,
    bool AutoConnect,
    string Status,
    DateTimeOffset UpdatedAt);

public sealed record UpsertDeviceRequest(
    string Name,
    string? DriverKind,
    string EndpointUrl,
    string? SecurityMode,
    string? SecurityPolicy,
    string? AuthMode,
    string? Username,
    string? Password,
    bool AutoConnect);

public sealed record TagDefinitionDto(
    Guid Id,
    Guid DeviceId,
    string NodeId,
    string BrowseName,
    string DisplayName,
    string DataType,
    double SamplingIntervalMs,
    double PublishingIntervalMs,
    bool AllowWrite,
    bool Enabled,
    string? GroupKey,
    DateTimeOffset UpdatedAt);

public sealed record UpsertTagRequest(
    Guid DeviceId,
    string NodeId,
    string BrowseName,
    string DisplayName,
    string DataType,
    double SamplingIntervalMs,
    double PublishingIntervalMs,
    bool AllowWrite,
    bool Enabled,
    string? GroupKey);

public sealed record BrowseNodeDto(
    string NodeId,
    string BrowseName,
    string DisplayName,
    string NodeClass,
    bool HasChildren,
    string? DataType,
    bool Writable);

public sealed record TagSnapshotDto(
    Guid TagId,
    Guid DeviceId,
    object? Value,
    string Quality,
    DateTimeOffset? SourceTimestamp,
    DateTimeOffset? ServerTimestamp,
    string ConnectionState);

public sealed record DeviceRuntimeDto(
    Guid DeviceId,
    string DeviceName,
    string Status,
    string EndpointUrl,
    int EnabledTagCount,
    int WritableTagCount);

public sealed record RuntimeOverviewDto(
    IReadOnlyList<DeviceRuntimeDto> Devices,
    IReadOnlyList<TagDefinitionDto> Tags,
    IReadOnlyList<TagSnapshotDto> Snapshots);

public sealed record WriteTagValueRequest(
    [property: JsonPropertyName("value")] object? Value);

public sealed record WriteOperationResultDto(
    Guid TagId,
    bool Succeeded,
    string StatusCode,
    string? Message);

public sealed record DeviceStatusChangedDto(
    Guid DeviceId,
    string Status,
    string Message,
    DateTimeOffset OccurredAt);

public sealed record TagUpdateItem(
    Guid Id,
    Guid DeviceId,
    string DisplayName,
    string? BrowseName,
    string? NodeId,
    string? DataType,
    string? GroupKey);

public sealed record TagImportRequest(
    List<TagUpdateItem> Tags);

public sealed record TagImportResultDto(
    int Total,
    int Updated,
    int Failed,
    List<string> Errors);

public sealed record TagExcelReplaceResultDto(
    int Total,
    int Created,
    int Removed,
    List<string> Errors);

public sealed record SiemensDbImportTagDto(
    string NodeId,
    string BrowseName,
    string DisplayName,
    string DataType,
    string GroupKey,
    bool AllowWrite);

public sealed record SiemensDbImportPreviewDto(
    string BlockName,
    int Total,
    IReadOnlyList<SiemensDbImportTagDto> Tags,
    IReadOnlyList<string> Warnings);

// 配方相关 DTO
public sealed record RecipeDto(
    Guid Id,
    string Name,
    string Description,
    string RecipeType,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt);

public sealed record RecipeDetailDto(
    Guid Id,
    string Name,
    string Description,
    string RecipeType,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    Dictionary<string, string> Items);

public sealed record SaveRecipeRequest(
    string Name,
    string Description,
    string RecipeType,
    Dictionary<string, string> Items);

public sealed record UpdateRecipeRequest(
    string Name,
    string Description,
    Dictionary<string, string> Items);

public sealed record RecipeSyncPairRequest(
    Guid SourceTagId,
    Guid TargetTagId,
    string Source,
    string Target,
    string? FieldKey);

public sealed record RecipeSyncRequest(
    string RecipeType,
    int RecipeIndex,
    IReadOnlyList<RecipeSyncPairRequest> Pairs);

public sealed record RecipeSyncIssueDto(
    string Target,
    string Source,
    string Value,
    string Reason);

public sealed record RecipeSyncResponseDto(
    int Succeeded,
    int Failed,
    int Skipped,
    IReadOnlyList<RecipeSyncIssueDto> Issues);

public sealed record EfficiencyTimelineSegmentDto(
    int FaceplateIndex,
    string StationName,
    string StateKey,
    string StateLabel,
    string ColorHex,
    DateTimeOffset StartedAt,
    DateTimeOffset EndedAt,
    bool IsDemo);

public sealed record EfficiencyTimelineLaneDto(
    int FaceplateIndex,
    string StationName,
    string CurrentStateKey,
    string CurrentStateLabel,
    string CurrentColorHex,
    IReadOnlyList<EfficiencyTimelineSegmentDto> Segments);

public sealed record EfficiencyTimelineResponseDto(
    DateTimeOffset WindowStart,
    DateTimeOffset WindowEnd,
    DateTimeOffset GeneratedAt,
    IReadOnlyList<EfficiencyTimelineLaneDto> Lanes);

public static class ScadaDtoMapper

{
    public static DeviceConnectionDto ToDto(this DeviceConnectionEntity entity)
    {
        return new DeviceConnectionDto(
            entity.Id,
            entity.Name,
            entity.DriverKind.ToString(),
            entity.EndpointUrl,
            entity.SecurityMode,
            entity.SecurityPolicy,
            entity.AuthMode,
            entity.Username,
            entity.AutoConnect,
            entity.Status.ToString(),
            entity.UpdatedAt);
    }

    public static TagDefinitionDto ToDto(this TagDefinitionEntity entity)
    {
        return new TagDefinitionDto(
            entity.Id,
            entity.DeviceId,
            entity.NodeId,
            entity.BrowseName,
            entity.DisplayName,
            entity.DataType,
            entity.SamplingIntervalMs,
            entity.PublishingIntervalMs,
            entity.AllowWrite,
            entity.Enabled,
            entity.GroupKey,
            entity.UpdatedAt);
    }

}
