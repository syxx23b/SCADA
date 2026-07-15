namespace Scada.Api.Domain;

public enum DeviceConnectionStatus
{
    Disconnected = 0,
    Connecting = 1,
    Connected = 2,
    Reconnecting = 3,
    Faulted = 4
}

public enum DeviceDriverKind
{
    OpcUa = 0,
    SiemensS7 = 1,
    Local = 2
}

public sealed class DeviceConnectionEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = string.Empty;

    public DeviceDriverKind DriverKind { get; set; } = DeviceDriverKind.OpcUa;

    public string EndpointUrl { get; set; } = string.Empty;

    public string SecurityMode { get; set; } = "None";

    public string SecurityPolicy { get; set; } = "None";

    public string AuthMode { get; set; } = "Anonymous";

    public string? Username { get; set; }

    public string? Password { get; set; }

    public bool AutoConnect { get; set; }

    public DeviceConnectionStatus Status { get; set; } = DeviceConnectionStatus.Disconnected;

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public List<TagDefinitionEntity> Tags { get; set; } = [];
}

public sealed class TagDefinitionEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid DeviceId { get; set; }

    public DeviceConnectionEntity? Device { get; set; }

    public string NodeId { get; set; } = string.Empty;

    public string BrowseName { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public string DataType { get; set; } = "String";

    public double SamplingIntervalMs { get; set; } = 500;

    public double PublishingIntervalMs { get; set; } = 500;

    public bool AllowWrite { get; set; }

    public bool Enabled { get; set; } = true;

    public string? GroupKey { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class WriteAuditEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public Guid DeviceId { get; set; }

    public Guid TagId { get; set; }

    public string OperationKind { get; set; } = "single";

    public string RequestedValue { get; set; } = string.Empty;

    public string? PreviousValue { get; set; }

    public string Result { get; set; } = string.Empty;

    public string? Message { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class TagValueStateEntity
{
    public Guid TagId { get; set; }

    public Guid DeviceId { get; set; }

    public string ValueJson { get; set; } = "null";

    public string Quality { get; set; } = "Good";

    public DateTimeOffset SourceTimestamp { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset ServerTimestamp { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public enum EfficiencyStateKind
{
    Disconnected = 0,
    Standby = 1,
    Running = 2,
    Fault = 3
}

public sealed class EfficiencyTimelineSegmentEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public int FaceplateIndex { get; set; }

    public string StationName { get; set; } = string.Empty;

    public EfficiencyStateKind State { get; set; } = EfficiencyStateKind.Disconnected;

    public DateTimeOffset StartedAt { get; set; }

    public DateTimeOffset EndedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;

    public bool IsDemo { get; set; }
}

public sealed class SystemSettingEntity
{
    public string Key { get; set; } = string.Empty;

    public string Value { get; set; } = string.Empty;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class WorkOrderEntity
{
    public int Id { get; set; }

    public string WorkOrderNo { get; set; } = string.Empty;

    public string ProductName { get; set; } = string.Empty;

    public int PlanQty { get; set; }

    public int CompletedQty { get; set; }

    public int Priority { get; set; } = 1;

    public string Status { get; set; } = WorkOrderStatuses.Pending;

    public DateTime DueDate { get; set; } = DateTime.UtcNow.Date;

    public DateTimeOffset? ArchivedAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;

    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class UploadInsertAuditEntity
{
    public long Id { get; set; }

    public int StationIndex { get; set; }

    public string TriggerKind { get; set; } = string.Empty;

    public string TargetTable { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public string? Tm { get; set; }

    public int? Gw { get; set; }

    public string? OrderNo { get; set; }

    public int? Mode { get; set; }

    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public static class WorkOrderStatuses
{
    public const string Pending = "待执行";
    public const string Running = "执行中";
    public const string Archived = "完工归档";

    public static readonly string[] All = [Pending, Running, Archived];

    public static bool IsValid(string? value)
    {
        return All.Any(item => item.Equals(value?.Trim(), StringComparison.Ordinal));
    }
}

public sealed record RecipeDefinition(Guid Id, string Name, string Description);

public sealed record RecipeItem(Guid TagId, string NodeId, string DataType, string GroupKey);

public sealed record RecipeExecution(Guid Id, Guid RecipeId, DateTimeOffset RequestedAt, string Status);
