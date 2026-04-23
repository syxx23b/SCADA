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
    SiemensS7 = 1
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

// 配方定义实体

public sealed class RecipeEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public string Name { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string RecipeType { get; set; } = string.Empty; // "DJ" 或 "QYJ"
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
    public DateTimeOffset UpdatedAt { get; set; } = DateTimeOffset.UtcNow;
    public List<RecipeItemEntity> Items { get; set; } = [];
}

// 配方项实体（存储每个标签的值）
public sealed class RecipeItemEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid RecipeId { get; set; }
    public RecipeEntity? Recipe { get; set; }
    public Guid TagId { get; set; } // 关联的标签ID
    public string FieldKey { get; set; } = string.Empty; // 字段名
    public string Value { get; set; } = string.Empty; // 存储的值
}

public sealed record RecipeDefinition(Guid Id, string Name, string Description);

public sealed record RecipeItem(Guid TagId, string NodeId, string DataType, string GroupKey);

public sealed record RecipeExecution(Guid Id, Guid RecipeId, DateTimeOffset RequestedAt, string Status);
