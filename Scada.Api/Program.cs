using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using Scada.Api.Data;
using Scada.Api.Hubs;
using Scada.Api.Services;
using Scada.Api.Services.Startup;
using Scada.OpcUa.Abstractions;
using Scada.OpcUa.Services;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Mime;

var builder = WebApplication.CreateBuilder(args);
builder.Host.UseWindowsService(options =>
{
    options.ServiceName = "Scada.Api";
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
builder.Services.AddHttpClient("ReportProxy", client =>
{
    client.BaseAddress = new Uri("http://localhost:8080");
    client.Timeout = Timeout.InfiniteTimeSpan;
}).ConfigurePrimaryHttpMessageHandler(() => new HttpClientHandler
{
    AllowAutoRedirect = false,
    UseCookies = true,
    CookieContainer = new CookieContainer(),
    AutomaticDecompression = DecompressionMethods.All,
});


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
    MigrateLegacySqliteScadaMeta(dbContext, Path.Combine(builder.Environment.ContentRootPath, "scada.db"));
    EnsureLocalDeviceAndTags(dbContext);
    app.Logger.LogInformation("Database initialized successfully");
}

app.UseCors();

app.UseAuthorization();
app.UseDefaultFiles();
app.UseStaticFiles();

app.MapControllers();
app.MapMethods("/webroot/decision/{**path}", new[] { "GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS" }, ProxyReportAsync);
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

app.Lifetime.ApplicationStarted.Register(() =>
{
    _ = Task.Run(() => EnsureReportProxyAuthenticatedAsync(app.Services));
});

app.Run();

static async Task<IResult> ProxyReportAsync(HttpContext context, IHttpClientFactory httpClientFactory)
{
    var client = httpClientFactory.CreateClient("ReportProxy");
    var targetUri = new UriBuilder(client.BaseAddress!)
    {
        Path = $"{context.Request.PathBase}{context.Request.Path}",
        Query = context.Request.QueryString.HasValue ? context.Request.QueryString.Value!.TrimStart('?') : string.Empty,
    }.Uri;

    using var responseMessage = await SendReportProxyRequestAsync(client, context, targetUri);

    if (NeedsReportReauthentication(responseMessage))
    {
        await EnsureReportProxyAuthenticatedAsync(context.RequestServices);
        using var retryResponse = await SendReportProxyRequestAsync(client, context, targetUri);
        return await WriteProxyResponseAsync(context, retryResponse);
    }

    return await WriteProxyResponseAsync(context, responseMessage);
}

static async Task<HttpResponseMessage> SendReportProxyRequestAsync(HttpClient client, HttpContext context, Uri targetUri)
{
    using var requestMessage = new HttpRequestMessage(new HttpMethod(context.Request.Method), targetUri);

    if (context.Request.ContentLength is > 0 || context.Request.Headers.ContainsKey("Transfer-Encoding"))
    {
        requestMessage.Content = new StreamContent(context.Request.Body);
        if (!string.IsNullOrWhiteSpace(context.Request.ContentType))
        {
            requestMessage.Content.Headers.ContentType = MediaTypeHeaderValue.Parse(context.Request.ContentType);
        }
    }

    foreach (var header in context.Request.Headers)
    {
        if (header.Key.Equals("Host", StringComparison.OrdinalIgnoreCase)) continue;
        if (header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
        if (header.Key.Equals("Content-Type", StringComparison.OrdinalIgnoreCase)) continue;
        if (header.Key.Equals("Connection", StringComparison.OrdinalIgnoreCase)) continue;
        if (header.Key.Equals("Accept-Encoding", StringComparison.OrdinalIgnoreCase)) continue;

        if (!requestMessage.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray()))
        {
            requestMessage.Content?.Headers.TryAddWithoutValidation(header.Key, header.Value.ToArray());
        }
    }

    return await client.SendAsync(requestMessage, HttpCompletionOption.ResponseHeadersRead, context.RequestAborted);
}

static bool NeedsReportReauthentication(HttpResponseMessage response)
{
    if (response.StatusCode != HttpStatusCode.Redirect) return false;

    var location = response.Headers.Location?.ToString() ?? string.Empty;
    return location.Contains("/webroot/decision/login", StringComparison.OrdinalIgnoreCase);
}

static async Task<IResult> WriteProxyResponseAsync(HttpContext context, HttpResponseMessage responseMessage)
{
    context.Response.StatusCode = (int)responseMessage.StatusCode;

    foreach (var header in responseMessage.Headers)
    {
        if (header.Key.Equals("Transfer-Encoding", StringComparison.OrdinalIgnoreCase)) continue;
        if (header.Key.Equals("Location", StringComparison.OrdinalIgnoreCase))
        {
            foreach (var value in header.Value)
            {
                context.Response.Headers.Append(header.Key, RewriteReportLocation(value));
            }
            continue;
        }

        context.Response.Headers[header.Key] = header.Value.ToArray();
    }

    foreach (var header in responseMessage.Content.Headers)
    {
        if (header.Key.Equals("Content-Length", StringComparison.OrdinalIgnoreCase)) continue;
        context.Response.Headers[header.Key] = header.Value.ToArray();
    }

    context.Response.Headers.Remove("transfer-encoding");
    context.Response.Headers.Remove("x-frame-options");
    context.Response.Headers.Remove("content-security-policy");

    if (HttpMethods.IsHead(context.Request.Method))
    {
        return Results.Empty;
    }

    await responseMessage.Content.CopyToAsync(context.Response.Body, context.RequestAborted);
    return Results.Empty;
}

static async Task EnsureReportProxyAuthenticatedAsync(IServiceProvider services)
{
    try
    {
        using var scope = services.CreateScope();
        var factory = scope.ServiceProvider.GetRequiredService<IHttpClientFactory>();
        var client = factory.CreateClient("ReportProxy");
        using var response = await client.GetAsync("/webroot/decision/login/cross/domain?validity=-1&fine_username=ZXC&fine_password=1826");
        response.EnsureSuccessStatusCode();
    }
    catch
    {
        // If warmup fails, the proxy can still retry on demand.
    }
}

static string RewriteReportLocation(string location)
{
    const string httpBase = "http://localhost:8080";
    const string httpsBase = "https://localhost:8080";

    if (location.StartsWith(httpBase, StringComparison.OrdinalIgnoreCase))
    {
        return location[httpBase.Length..];
    }

    if (location.StartsWith(httpsBase, StringComparison.OrdinalIgnoreCase))
    {
        return location[httpsBase.Length..];
    }

    return location;
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

static void MigrateLegacySqliteScadaMeta(ScadaDbContext dbContext, string sqlitePath)
{
    if (!File.Exists(sqlitePath))
    {
        return;
    }

    var hasAnyDevice = dbContext.Devices.AsNoTracking().Any();
    var hasAnyTag = dbContext.Tags.AsNoTracking().Any();
    if (hasAnyDevice && hasAnyTag)
    {
        return;
    }

    var sqliteConnectionString = new SqliteConnectionStringBuilder { DataSource = sqlitePath }.ToString();
    using var sqliteConnection = new SqliteConnection(sqliteConnectionString);
    sqliteConnection.Open();

    using var sqliteDeviceCmd = sqliteConnection.CreateCommand();
    sqliteDeviceCmd.CommandText = SqliteColumnExists(sqliteConnection, "Devices", "DriverKind")
        ? "SELECT Id, Name, DriverKind, EndpointUrl, SecurityMode, SecurityPolicy, AuthMode, Username, Password, AutoConnect, Status, CreatedAt, UpdatedAt FROM Devices"
        : "SELECT Id, Name, 'OpcUa' AS DriverKind, EndpointUrl, SecurityMode, SecurityPolicy, AuthMode, Username, Password, AutoConnect, Status, CreatedAt, UpdatedAt FROM Devices";
    using var deviceReader = sqliteDeviceCmd.ExecuteReader();
    while (deviceReader.Read())
    {
        var id = Guid.Parse(deviceReader.GetString(0));
        if (dbContext.Devices.Any(item => item.Id == id))
        {
            continue;
        }

        dbContext.Devices.Add(new Scada.Api.Domain.DeviceConnectionEntity
        {
            Id = id,
            Name = deviceReader.GetString(1),
            DriverKind = Enum.TryParse<Scada.Api.Domain.DeviceDriverKind>(deviceReader.GetString(2), true, out var driverKind)
                ? driverKind
                : Scada.Api.Domain.DeviceDriverKind.OpcUa,
            EndpointUrl = deviceReader.GetString(3),
            SecurityMode = deviceReader.GetString(4),
            SecurityPolicy = deviceReader.GetString(5),
            AuthMode = deviceReader.GetString(6),
            Username = deviceReader.IsDBNull(7) ? null : deviceReader.GetString(7),
            Password = deviceReader.IsDBNull(8) ? null : deviceReader.GetString(8),
            AutoConnect = deviceReader.GetBoolean(9),
            Status = Enum.TryParse<Scada.Api.Domain.DeviceConnectionStatus>(deviceReader.GetString(10), true, out var status)
                ? status
                : Scada.Api.Domain.DeviceConnectionStatus.Disconnected,
            CreatedAt = DateTimeOffset.Parse(deviceReader.GetString(11)),
            UpdatedAt = DateTimeOffset.Parse(deviceReader.GetString(12)),
        });
    }
    dbContext.SaveChanges();

    using var sqliteTagCmd = sqliteConnection.CreateCommand();
    sqliteTagCmd.CommandText = "SELECT Id, DeviceId, NodeId, BrowseName, DisplayName, DataType, SamplingIntervalMs, PublishingIntervalMs, AllowWrite, Enabled, GroupKey, CreatedAt, UpdatedAt FROM Tags";
    using var tagReader = sqliteTagCmd.ExecuteReader();
    while (tagReader.Read())
    {
        var id = Guid.Parse(tagReader.GetString(0));
        if (dbContext.Tags.Any(item => item.Id == id))
        {
            continue;
        }

        dbContext.Tags.Add(new Scada.Api.Domain.TagDefinitionEntity
        {
            Id = id,
            DeviceId = Guid.Parse(tagReader.GetString(1)),
            NodeId = tagReader.GetString(2),
            BrowseName = tagReader.GetString(3),
            DisplayName = tagReader.GetString(4),
            DataType = tagReader.GetString(5),
            SamplingIntervalMs = tagReader.GetDouble(6),
            PublishingIntervalMs = tagReader.GetDouble(7),
            AllowWrite = tagReader.GetBoolean(8),
            Enabled = tagReader.GetBoolean(9),
            GroupKey = tagReader.IsDBNull(10) ? null : tagReader.GetString(10),
            CreatedAt = DateTimeOffset.Parse(tagReader.GetString(11)),
            UpdatedAt = DateTimeOffset.Parse(tagReader.GetString(12)),
        });
    }
    dbContext.SaveChanges();
}

static bool SqliteColumnExists(SqliteConnection connection, string tableName, string columnName)
{
    using var command = connection.CreateCommand();
    command.CommandText = $"PRAGMA table_info({tableName})";
    using var reader = command.ExecuteReader();
    while (reader.Read())
    {
        if (reader.GetString(1).Equals(columnName, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }
    }

    return false;
}

static void EnsureLocalDeviceAndTags(ScadaDbContext dbContext)
{
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
            AutoConnect = false,
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

    if (localTags.Count == 0)
    {
        return;
    }

    foreach (var tag in localTags)
    {
        tag.DeviceId = localDevice.Id;
        tag.UpdatedAt = DateTimeOffset.UtcNow;
    }

    dbContext.SaveChanges();
}

public partial class Program;

