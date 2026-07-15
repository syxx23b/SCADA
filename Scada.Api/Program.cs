using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Hubs;
using Scada.Api.Services;
using Scada.Api.Services.Startup;
using Scada.OpcUa.Abstractions;
using Scada.OpcUa.Services;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseWindowsService(options =>
{
    options.ServiceName = "0Scada_ZXC";
});

var scadaConnectionString =
    builder.Configuration.GetConnectionString("ScadaDb")
    ?? builder.Configuration.GetConnectionString("MssqlRecordDb")
    ?? throw new InvalidOperationException("Missing connection string: ScadaDb or MssqlRecordDb");


builder.Logging.ClearProviders();
builder.Logging.AddConsole();

builder.Services.AddControllers();
builder.Services.AddSignalR();
builder.Services.AddCors(options =>
{
    var allowedOrigins = builder.Configuration.GetSection("Cors:AllowedOrigins").Get<string[]>() ?? Array.Empty<string>();
    options.AddDefaultPolicy(policy =>
    {
        if (allowedOrigins.Length == 0)
        {
            policy.AllowAnyHeader().AllowAnyMethod().AllowAnyOrigin();
            return;
        }

        policy.WithOrigins(allowedOrigins)
            .AllowAnyHeader()
            .AllowAnyMethod()
            .AllowCredentials();
    });
});

builder.Services.AddDbContext<ScadaDbContext>(options =>
    options.UseSqlServer(scadaConnectionString));

builder.Services.AddSingleton<TagSnapshotCache>();
builder.Services.AddSingleton<RealtimeNotifier>();
builder.Services.AddSingleton<ISiemensDbTagImportService, SiemensDbTagImportService>();
builder.Services.AddSingleton<IOpcUaSessionClientFactory, OpcUaSessionClientFactory>();
builder.Services.AddSingleton<IDeviceSessionClientFactory, DeviceSessionClientFactory>();
builder.Services.AddSingleton<IScadaRuntimeCoordinator, ScadaRuntimeCoordinator>();
builder.Services.AddSingleton<IEfficiencyAnalysisService, EfficiencyAnalysisService>();
builder.Services.AddSingleton<IMssqlRecipeStore, MssqlRecipeStore>();
builder.Services.AddScoped<ISingleTagWriteCoordinator, SingleTagWriteCoordinator>();
builder.Services.AddSingleton<IBatchWriteCoordinator, BatchWriteCoordinator>();
builder.Services.AddHostedService<StartupConnectionInitializerHostedService>();
builder.Services.AddHostedService<EfficiencyTimelineCollectorHostedService>();
builder.Services.AddHostedService<RecipeSubscriptionLeaseHostedService>();
builder.Services.AddHostedService<Upload2SqlWriterHostedService>();
builder.Services.AddHostedService<WorkOrderRecordSyncHostedService>();


var app = builder.Build();

app.Logger.LogInformation("Using MSSQL metadata database.");

// 确保数据库及配方表已创建
using (var scope = app.Services.CreateScope())
{
    var recipeStore = scope.ServiceProvider.GetRequiredService<IMssqlRecipeStore>();
    await recipeStore.EnsureInitializedAsync();

    var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
    EnsureScadaCoreTables(dbContext);
    EnsureEfficiencyTables(dbContext);
    EnsureDeviceSchema(dbContext);
    EnsureLocalDeviceAndTags(dbContext);
    app.Logger.LogInformation("Database initialized successfully");
}

app.UseCors();

app.UseAuthorization();
app.UseDefaultFiles();
app.UseStaticFiles(new StaticFileOptions
{
    OnPrepareResponse = context =>
    {
        if (string.Equals(context.File.Name, "index.html", StringComparison.OrdinalIgnoreCase))
        {
            ApplyNoCacheHeaders(context.Context.Response);
        }
    }
});

app.Use(async (context, next) =>
{
    await next();

    if (!HttpMethods.IsGet(context.Request.Method) && !HttpMethods.IsHead(context.Request.Method))
    {
        return;
    }

    var responseContentType = context.Response.ContentType ?? string.Empty;
    if (!responseContentType.StartsWith("text/html", StringComparison.OrdinalIgnoreCase))
    {
        return;
    }

    ApplyNoCacheHeaders(context.Response);
});

app.MapControllers();
app.MapGet("/help/manual", () =>
{
    var manualPath = "C:\\[松门电器]高压清洗机测试系统操作手册.v2023.pdf";
    if (!File.Exists(manualPath))
    {
        return Results.NotFound(new { message = $"帮助文档不存在: {manualPath}" });
    }

    return Results.File(manualPath, "application/pdf", enableRangeProcessing: true);
});
app.MapHub<RealtimeHub>("/hubs/realtime");
app.MapFallbackToFile("index.html");

app.Run();

static void ApplyNoCacheHeaders(HttpResponse response)
{
    response.Headers.CacheControl = "no-store, no-cache, must-revalidate, max-age=0";
    response.Headers.Pragma = "no-cache";
    response.Headers.Expires = "0";
}

static void EnsureEfficiencyTables(ScadaDbContext dbContext)
{
    // SQL Server schema is created by EF EnsureCreated.
}

static void EnsureScadaCoreTables(ScadaDbContext dbContext)
{
    const string ensureSchemasSql = """
IF SCHEMA_ID(N'Tag') IS NULL EXEC(N'CREATE SCHEMA [Tag]');
IF SCHEMA_ID(N'OEE') IS NULL EXEC(N'CREATE SCHEMA [OEE]');
IF SCHEMA_ID(N'Process') IS NULL EXEC(N'CREATE SCHEMA [Process]');
""";
    dbContext.Database.ExecuteSqlRaw(ensureSchemasSql);

    const string migrateDevicesSchemaSql = """
IF OBJECT_ID(N'[Tag].[Devices]', N'U') IS NULL AND OBJECT_ID(N'[dbo].[Devices]', N'U') IS NOT NULL
BEGIN
    EXEC(N'ALTER SCHEMA [Tag] TRANSFER [dbo].[Devices]');
END
""";
    dbContext.Database.ExecuteSqlRaw(migrateDevicesSchemaSql);

    const string migrateTagsSchemaSql = """
IF OBJECT_ID(N'[Tag].[Tags]', N'U') IS NULL AND OBJECT_ID(N'[dbo].[Tags]', N'U') IS NOT NULL
BEGIN
    EXEC(N'ALTER SCHEMA [Tag] TRANSFER [dbo].[Tags]');
END
""";
    dbContext.Database.ExecuteSqlRaw(migrateTagsSchemaSql);

    const string migrateWriteAuditsSchemaSql = """
IF OBJECT_ID(N'[Process].[WriteAudits]', N'U') IS NULL AND OBJECT_ID(N'[dbo].[WriteAudits]', N'U') IS NOT NULL
BEGIN
    EXEC(N'ALTER SCHEMA [Process] TRANSFER [dbo].[WriteAudits]');
END
""";
    dbContext.Database.ExecuteSqlRaw(migrateWriteAuditsSchemaSql);

    const string migrateSystemSettingsSchemaSql = """
IF OBJECT_ID(N'[Process].[SystemSettings]', N'U') IS NULL AND OBJECT_ID(N'[dbo].[SystemSettings]', N'U') IS NOT NULL
BEGIN
    EXEC(N'ALTER SCHEMA [Process] TRANSFER [dbo].[SystemSettings]');
END
""";
    dbContext.Database.ExecuteSqlRaw(migrateSystemSettingsSchemaSql);

    const string migrateEfficiencySchemaSql = """
IF OBJECT_ID(N'[OEE].[EfficiencyTimelineSegments]', N'U') IS NULL AND OBJECT_ID(N'[dbo].[EfficiencyTimelineSegments]', N'U') IS NOT NULL
BEGIN
    EXEC(N'ALTER SCHEMA [OEE] TRANSFER [dbo].[EfficiencyTimelineSegments]');
END
""";
    dbContext.Database.ExecuteSqlRaw(migrateEfficiencySchemaSql);

    const string ensureDevicesSql = """
IF OBJECT_ID(N'[Tag].[Devices]', N'U') IS NULL
BEGIN
    CREATE TABLE [Tag].[Devices](
        [Id] uniqueidentifier NOT NULL CONSTRAINT [PK_Devices] PRIMARY KEY,
        [Name] nvarchar(120) NOT NULL,
        [DriverKind] nvarchar(32) NOT NULL CONSTRAINT [DF_Devices_DriverKind] DEFAULT(N'OpcUa'),
        [EndpointUrl] nvarchar(256) NOT NULL,
        [SecurityMode] nvarchar(32) NOT NULL,
        [SecurityPolicy] nvarchar(64) NOT NULL,
        [AuthMode] nvarchar(32) NOT NULL,
        [Username] nvarchar(max) NULL,
        [Password] nvarchar(max) NULL,
        [AutoConnect] bit NOT NULL,
        [Status] nvarchar(32) NOT NULL,
        [CreatedAt] datetimeoffset(7) NOT NULL,
        [UpdatedAt] datetimeoffset(7) NOT NULL
    );
END
""";
    dbContext.Database.ExecuteSqlRaw(ensureDevicesSql);

    const string ensureTagsSql = """
IF OBJECT_ID(N'[Tag].[Tags]', N'U') IS NULL
BEGIN
    CREATE TABLE [Tag].[Tags](
        [Id] uniqueidentifier NOT NULL CONSTRAINT [PK_Tags] PRIMARY KEY,
        [DeviceId] uniqueidentifier NOT NULL,
        [NodeId] nvarchar(256) NOT NULL,
        [BrowseName] nvarchar(128) NOT NULL,
        [DisplayName] nvarchar(128) NOT NULL,
        [DataType] nvarchar(64) NOT NULL,
        [SamplingIntervalMs] float NOT NULL,
        [PublishingIntervalMs] float NOT NULL,
        [AllowWrite] bit NOT NULL,
        [Enabled] bit NOT NULL,
        [GroupKey] nvarchar(64) NULL,
        [CreatedAt] datetimeoffset(7) NOT NULL,
        [UpdatedAt] datetimeoffset(7) NOT NULL,
        CONSTRAINT [FK_Tags_Devices_DeviceId] FOREIGN KEY([DeviceId]) REFERENCES [Tag].[Devices]([Id]) ON DELETE CASCADE
    );
END
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_Tags_DeviceId_NodeId' AND object_id = OBJECT_ID(N'[Tag].[Tags]'))
BEGIN
    CREATE UNIQUE INDEX [IX_Tags_DeviceId_NodeId] ON [Tag].[Tags]([DeviceId], [NodeId]);
END
""";
    dbContext.Database.ExecuteSqlRaw(ensureTagsSql);

    const string ensureWriteAuditsSql = """
IF OBJECT_ID(N'[Process].[WriteAudits]', N'U') IS NULL
BEGIN
    CREATE TABLE [Process].[WriteAudits](
        [Id] uniqueidentifier NOT NULL CONSTRAINT [PK_WriteAudits] PRIMARY KEY,
        [DeviceId] uniqueidentifier NOT NULL,
        [TagId] uniqueidentifier NOT NULL,
        [OperationKind] nvarchar(32) NOT NULL,
        [RequestedValue] nvarchar(4000) NOT NULL,
        [PreviousValue] nvarchar(4000) NULL,
        [Result] nvarchar(64) NOT NULL,
        [Message] nvarchar(1000) NULL,
        [CreatedAt] datetimeoffset(7) NOT NULL
    );
END
""";
    dbContext.Database.ExecuteSqlRaw(ensureWriteAuditsSql);

    const string ensureTagValueStatesSql = """
IF OBJECT_ID(N'[Process].[TagValueStates]', N'U') IS NULL
BEGIN
    CREATE TABLE [Process].[TagValueStates](
        [TagId] uniqueidentifier NOT NULL CONSTRAINT [PK_TagValueStates] PRIMARY KEY,
        [DeviceId] uniqueidentifier NOT NULL,
        [ValueJson] nvarchar(4000) NOT NULL,
        [Quality] nvarchar(64) NOT NULL,
        [SourceTimestamp] datetimeoffset(7) NOT NULL,
        [ServerTimestamp] datetimeoffset(7) NOT NULL,
        [UpdatedAt] datetimeoffset(7) NOT NULL
    );
END
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_TagValueStates_DeviceId' AND object_id = OBJECT_ID(N'[Process].[TagValueStates]'))
BEGIN
    CREATE INDEX [IX_TagValueStates_DeviceId] ON [Process].[TagValueStates]([DeviceId]);
END
""";
    dbContext.Database.ExecuteSqlRaw(ensureTagValueStatesSql);

    const string ensureUploadInsertAuditsSql = """
IF OBJECT_ID(N'[Process].[UploadInsertAudits]', N'U') IS NULL
BEGIN
    CREATE TABLE [Process].[UploadInsertAudits](
        [Id] bigint IDENTITY(1,1) NOT NULL CONSTRAINT [PK_UploadInsertAudits] PRIMARY KEY,
        [StationIndex] int NOT NULL,
        [TriggerKind] nvarchar(16) NOT NULL,
        [TargetTable] nvarchar(64) NOT NULL,
        [DisplayName] nvarchar(128) NOT NULL,
        [Tm] nvarchar(80) NULL,
        [Gw] int NULL,
        [OrderNo] nvarchar(80) NULL,
        [Mode] int NULL,
        [CreatedAt] datetimeoffset(7) NOT NULL
    );
END
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UploadInsertAudits_CreatedAt' AND object_id = OBJECT_ID(N'[Process].[UploadInsertAudits]'))
BEGIN
    CREATE INDEX [IX_UploadInsertAudits_CreatedAt] ON [Process].[UploadInsertAudits]([CreatedAt]);
END
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_UploadInsertAudits_StationIndex_TriggerKind_CreatedAt' AND object_id = OBJECT_ID(N'[Process].[UploadInsertAudits]'))
BEGIN
    CREATE INDEX [IX_UploadInsertAudits_StationIndex_TriggerKind_CreatedAt] ON [Process].[UploadInsertAudits]([StationIndex], [TriggerKind], [CreatedAt]);
END
DELETE FROM [Process].[UploadInsertAudits]
WHERE [CreatedAt] < DATEADD(month, -1, SYSUTCDATETIME());
""";
    dbContext.Database.ExecuteSqlRaw(ensureUploadInsertAuditsSql);

    const string ensureSystemSettingsSql = """
IF OBJECT_ID(N'[Process].[SystemSettings]', N'U') IS NULL
BEGIN
    CREATE TABLE [Process].[SystemSettings](
        [Key] nvarchar(64) NOT NULL CONSTRAINT [PK_SystemSettings] PRIMARY KEY,
        [Value] nvarchar(512) NOT NULL,
        [UpdatedAt] datetimeoffset(7) NOT NULL
    );
END

IF COL_LENGTH(N'[Process].[SystemSettings]', N'Value') IS NOT NULL
BEGIN
    ALTER TABLE [Process].[SystemSettings] ALTER COLUMN [Value] nvarchar(512) NOT NULL;
END

MERGE [Process].[SystemSettings] AS target
USING (VALUES
    (N'StationCount', N'4'),
    (N'PressureUnit', N'MPa'),
    (N'FlowUnit', N'L/M'),
    (N'VisibleMenuKeys', N'nativeFactoryReportTest,nativeEnduranceReportTest,nativeGasEngineFactoryReportTest,nativeGasEngineEnduranceReportTest,workOrderCreate,recipeDj,recipeQyj')
) AS source([Key], [Value])
ON target.[Key] = source.[Key]
WHEN NOT MATCHED THEN
    INSERT ([Key], [Value], [UpdatedAt]) VALUES (source.[Key], source.[Value], SYSUTCDATETIME());

UPDATE [Process].[SystemSettings]
SET [Value] = CONCAT([Value], N',workOrderCreate'),
    [UpdatedAt] = SYSUTCDATETIME()
WHERE [Key] = N'VisibleMenuKeys' AND CHARINDEX(N'workOrderCreate', [Value]) = 0;

UPDATE [Process].[SystemSettings]
SET [Value] = SUBSTRING(
        REPLACE(REPLACE(REPLACE(REPLACE(CONCAT(N',', [Value], N','), N',productArchive,', N','), N',workOrderAnalysis,', N','), N',,', N','), N',,', N','),
        2,
        LEN(REPLACE(REPLACE(REPLACE(REPLACE(CONCAT(N',', [Value], N','), N',productArchive,', N','), N',workOrderAnalysis,', N','), N',,', N','), N',,', N',')) - 2
    ),
    [UpdatedAt] = SYSUTCDATETIME()
WHERE [Key] = N'VisibleMenuKeys' AND (CHARINDEX(N'productArchive', [Value]) > 0 OR CHARINDEX(N'workOrderAnalysis', [Value]) > 0);
""";
    dbContext.Database.ExecuteSqlRaw(ensureSystemSettingsSql);

    const string ensureWorkOrderSql = """
IF OBJECT_ID(N'[Process].[WorkOrders]', N'U') IS NULL
BEGIN
    CREATE TABLE [Process].[WorkOrders](
        [Id] int IDENTITY(1,1) NOT NULL CONSTRAINT [PK_WorkOrders] PRIMARY KEY,
        [WorkOrderNo] nvarchar(80) NOT NULL,
        [ProductName] nvarchar(120) NOT NULL,
        [PlanQty] int NOT NULL,
        [CompletedQty] int NOT NULL CONSTRAINT [DF_WorkOrders_CompletedQty] DEFAULT(0),
        [Priority] int NOT NULL CONSTRAINT [DF_WorkOrders_Priority] DEFAULT(1),
        [Status] nvarchar(40) NOT NULL,
        [DueDate] date NOT NULL,
        [ArchivedAt] datetimeoffset(7) NULL,
        [CreatedAt] datetimeoffset(7) NOT NULL,
        [UpdatedAt] datetimeoffset(7) NOT NULL
    );
END

IF OBJECT_ID(N'[Process].[WorkOrders]', N'U') IS NOT NULL
BEGIN
    DECLARE @fkName nvarchar(128);
    SELECT @fkName = fk.[name]
    FROM sys.foreign_keys fk
    WHERE fk.parent_object_id = OBJECT_ID(N'[Process].[WorkOrders]')
      AND fk.referenced_object_id = OBJECT_ID(N'[Process].[Products]');

    IF @fkName IS NOT NULL
    BEGIN
        EXEC(N'ALTER TABLE [Process].[WorkOrders] DROP CONSTRAINT [' + @fkName + N']');
    END

    IF COL_LENGTH(N'[Process].[WorkOrders]', N'ProductName') IS NULL
    BEGIN
        ALTER TABLE [Process].[WorkOrders] ADD [ProductName] nvarchar(120) NOT NULL CONSTRAINT [DF_WorkOrders_ProductName] DEFAULT(N'');
    END

    IF COL_LENGTH(N'[Process].[WorkOrders]', N'ProductId') IS NOT NULL
    BEGIN
        ALTER TABLE [Process].[WorkOrders] DROP COLUMN [ProductId];
    END

    IF COL_LENGTH(N'[Process].[WorkOrders]', N'ProductCode') IS NOT NULL
    BEGIN
        ALTER TABLE [Process].[WorkOrders] DROP COLUMN [ProductCode];
    END
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkOrders_WorkOrderNo' AND object_id = OBJECT_ID(N'[Process].[WorkOrders]'))
BEGIN
    CREATE UNIQUE INDEX [IX_WorkOrders_WorkOrderNo] ON [Process].[WorkOrders]([WorkOrderNo]);
END
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_WorkOrders_Status' AND object_id = OBJECT_ID(N'[Process].[WorkOrders]'))
BEGIN
    CREATE INDEX [IX_WorkOrders_Status] ON [Process].[WorkOrders]([Status]);
END

IF OBJECT_ID(N'[Process].[Products]', N'U') IS NOT NULL
BEGIN
    DROP TABLE [Process].[Products];
END
""";
    dbContext.Database.ExecuteSqlRaw(ensureWorkOrderSql);

    const string ensureEfficiencySql = """
IF OBJECT_ID(N'[OEE].[EfficiencyTimelineSegments]', N'U') IS NULL
BEGIN
    CREATE TABLE [OEE].[EfficiencyTimelineSegments](
        [Id] uniqueidentifier NOT NULL CONSTRAINT [PK_EfficiencyTimelineSegments] PRIMARY KEY,
        [FaceplateIndex] int NOT NULL,
        [StationName] nvarchar(120) NOT NULL,
        [State] nvarchar(24) NOT NULL,
        [StartedAt] datetimeoffset(7) NOT NULL,
        [EndedAt] datetimeoffset(7) NOT NULL,
        [UpdatedAt] datetimeoffset(7) NOT NULL,
        [IsDemo] bit NOT NULL
    );
END
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_EfficiencyTimelineSegments_FaceplateIndex_StartedAt' AND object_id = OBJECT_ID(N'[OEE].[EfficiencyTimelineSegments]'))
BEGIN
    CREATE INDEX [IX_EfficiencyTimelineSegments_FaceplateIndex_StartedAt] ON [OEE].[EfficiencyTimelineSegments]([FaceplateIndex],[StartedAt]);
END
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'IX_EfficiencyTimelineSegments_FaceplateIndex_EndedAt' AND object_id = OBJECT_ID(N'[OEE].[EfficiencyTimelineSegments]'))
BEGIN
    CREATE INDEX [IX_EfficiencyTimelineSegments_FaceplateIndex_EndedAt] ON [OEE].[EfficiencyTimelineSegments]([FaceplateIndex],[EndedAt]);
END
""";
    dbContext.Database.ExecuteSqlRaw(ensureEfficiencySql);
}

static void EnsureDeviceSchema(ScadaDbContext dbContext)
{
    const string ensureDriverKindSql = """
IF COL_LENGTH('Tag.Devices', 'DriverKind') IS NULL
BEGIN
    ALTER TABLE [Tag].[Devices] ADD DriverKind nvarchar(32) NOT NULL CONSTRAINT DF_Devices_DriverKind DEFAULT('OpcUa');
END
""";
    dbContext.Database.ExecuteSqlRaw(ensureDriverKindSql);
}

static void EnsureLocalDeviceAndTags(ScadaDbContext dbContext)
{
    var nonAutoConnectDevices = dbContext.Devices.Where(item => !item.AutoConnect).ToList();
    if (nonAutoConnectDevices.Count > 0)
    {
        foreach (var device in nonAutoConnectDevices)
        {
            device.AutoConnect = true;
            device.UpdatedAt = DateTimeOffset.UtcNow;
        }

        dbContext.SaveChanges();
    }

    var localDevice = dbContext.Devices.FirstOrDefault(item => item.Name == "Local");
    if (localDevice is null)
    {
        localDevice = new Scada.Api.Domain.DeviceConnectionEntity
        {
            Name = "Local",
            DriverKind = Scada.Api.Domain.DeviceDriverKind.Local,
            EndpointUrl = "local://static",
            SecurityMode = "None",
            SecurityPolicy = "None",
            AuthMode = "Anonymous",
            AutoConnect = true,
            Status = Scada.Api.Domain.DeviceConnectionStatus.Disconnected
        };

        dbContext.Devices.Add(localDevice);
        dbContext.SaveChanges();
    }

    var localGroupKeys = new[]
    {
        "Local",
        "Local Variable",
        "Device1_LocalVariable",
        "Local.RecipeDJ",
        "Local.RecipeQYJ"
    };

    var localTags = dbContext.Tags
        .Where(tag => localGroupKeys.Contains(tag.GroupKey) && tag.DeviceId != localDevice.Id)
        .ToList();

    if (localTags.Count > 0)
    {
        foreach (var tag in localTags)
        {
            tag.DeviceId = localDevice.Id;
            tag.UpdatedAt = DateTimeOffset.UtcNow;
        }

        dbContext.SaveChanges();
    }

    MigrateLocalOrderNoTags(dbContext, localDevice.Id);
    EnsureLocalDefaultTags(dbContext, localDevice.Id);
}

static void MigrateLocalOrderNoTags(ScadaDbContext dbContext, Guid localDeviceId)
{
    var legacyTags = dbContext.Tags
        .Where(tag => tag.DeviceId == localDeviceId &&
                      tag.GroupKey == "Local" &&
                      tag.DisplayName.StartsWith("OrderNo.["))
        .ToList();

    if (legacyTags.Count == 0)
    {
        return;
    }

    var existingNames = dbContext.Tags
        .Where(tag => tag.DeviceId == localDeviceId)
        .Select(tag => tag.DisplayName)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    foreach (var tag in legacyTags)
    {
        var updatedName = tag.DisplayName.Replace("OrderNo.[", "OrderNo[", StringComparison.OrdinalIgnoreCase);
        if (existingNames.Contains(updatedName))
        {
            continue;
        }

        existingNames.Remove(tag.DisplayName);
        existingNames.Add(updatedName);
        tag.DisplayName = updatedName;
        tag.BrowseName = updatedName;
        tag.UpdatedAt = DateTimeOffset.UtcNow;
    }

    dbContext.SaveChanges();
}

static void EnsureLocalDefaultTags(ScadaDbContext dbContext, Guid localDeviceId)
{
    var existingNames = dbContext.Tags
        .Where(tag => tag.DeviceId == localDeviceId)
        .Select(tag => tag.DisplayName)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);
    var existingNodeIds = dbContext.Tags
        .Where(tag => tag.DeviceId == localDeviceId)
        .Select(tag => tag.NodeId)
        .ToHashSet(StringComparer.OrdinalIgnoreCase);

    var now = DateTimeOffset.UtcNow;
    var newTags = new List<Scada.Api.Domain.TagDefinitionEntity>();

    for (var index = 1; index <= 50; index++)
    {
        AddLocalStringTagIfMissing(newTags, existingNames, existingNodeIds, localDeviceId, $"OrderNo[{index}]", $"local://static/OrderNo_{index}", now);
        AddLocalStringTagIfMissing(newTags, existingNames, existingNodeIds, localDeviceId, $"ry[{index}]", $"local://static/ry_{index}", now);
    }

    if (newTags.Count == 0)
    {
        return;
    }

    dbContext.Tags.AddRange(newTags);
    dbContext.SaveChanges();
}

static void AddLocalStringTagIfMissing(
    List<Scada.Api.Domain.TagDefinitionEntity> tags,
    HashSet<string> existingNames,
    HashSet<string> existingNodeIds,
    Guid localDeviceId,
    string name,
    string nodeId,
    DateTimeOffset now)
{
    if (!existingNames.Add(name) || !existingNodeIds.Add(nodeId))
    {
        return;
    }

    tags.Add(new Scada.Api.Domain.TagDefinitionEntity
    {
        DeviceId = localDeviceId,
        NodeId = nodeId,
        BrowseName = name,
        DisplayName = name,
        DataType = "String[40]",
        SamplingIntervalMs = 0,
        PublishingIntervalMs = 0,
        AllowWrite = true,
        Enabled = true,
        GroupKey = "Local",
        CreatedAt = now,
        UpdatedAt = now
    });
}

public partial class Program;

