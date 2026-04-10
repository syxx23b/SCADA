namespace Scada.Api.Domain;

public enum DeviceConnectionStatus
{
    Disconnected = 0,
    Connecting = 1,
    Connected = 2,
    Reconnecting = 3,
    Faulted = 4
}

public sealed class DeviceConnectionEntity
{
    public Guid Id { get; set; } = Guid.NewGuid();

    public string Name { get; set; } = string.Empty;

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

public sealed record RecipeDefinition(Guid Id, string Name, string Description);

public sealed record RecipeItem(Guid TagId, string NodeId, string DataType, string GroupKey);

public sealed record RecipeExecution(Guid Id, Guid RecipeId, DateTimeOffset RequestedAt, string Status);
