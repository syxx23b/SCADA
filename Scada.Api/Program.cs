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
var scadaConnectionString = ResolveSqliteConnectionString(
    builder.Configuration.GetConnectionString("ScadaDb") ?? "Data Source=scada.db",
    builder.Environment.ContentRootPath);


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
    options.UseSqlite(scadaConnectionString));

builder.Services.AddSingleton<TagSnapshotCache>();
builder.Services.AddSingleton<RealtimeNotifier>();
builder.Services.AddSingleton<ISiemensDbTagImportService, SiemensDbTagImportService>();
builder.Services.AddSingleton<IOpcUaSessionClientFactory, OpcUaSessionClientFactory>();
builder.Services.AddSingleton<IDeviceSessionClientFactory, DeviceSessionClientFactory>();
builder.Services.AddSingleton<IScadaRuntimeCoordinator, ScadaRuntimeCoordinator>();
builder.Services.AddSingleton<IEfficiencyAnalysisService, EfficiencyAnalysisService>();
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

app.Logger.LogInformation("Using SQLite database at {DatabasePath}", new SqliteConnectionStringBuilder(scadaConnectionString).DataSource);

// 确保数据库及配方表已创建
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
    dbContext.Database.EnsureCreated();
    EnsureRecipeTables(dbContext);
    EnsureEfficiencyTables(dbContext);
    EnsureDeviceSchema(dbContext);
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

await EnsureReportProxyAuthenticatedAsync(app.Services);

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

static string ResolveSqliteConnectionString(string connectionString, string basePath)
{
    var builder = new SqliteConnectionStringBuilder(connectionString);
    if (!string.IsNullOrWhiteSpace(builder.DataSource) &&
        builder.DataSource != ":memory:" &&
        !Path.IsPathRooted(builder.DataSource))
    {
        builder.DataSource = Path.Combine(basePath, builder.DataSource);
    }

    return builder.ToString();
}

static void EnsureRecipeTables(ScadaDbContext dbContext)
{
    dbContext.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS Recipes (
            Id TEXT NOT NULL CONSTRAINT PK_Recipes PRIMARY KEY,
            Name TEXT NOT NULL,
            Description TEXT NOT NULL,
            RecipeType TEXT NOT NULL,
            CreatedAt TEXT NOT NULL,
            UpdatedAt TEXT NOT NULL
        );
        """);

    dbContext.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS RecipeItems (
            Id TEXT NOT NULL CONSTRAINT PK_RecipeItems PRIMARY KEY,
            RecipeId TEXT NOT NULL,
            TagId TEXT NOT NULL,
            FieldKey TEXT NOT NULL,
            Value TEXT NOT NULL,
            CONSTRAINT FK_RecipeItems_Recipes_RecipeId FOREIGN KEY (RecipeId) REFERENCES Recipes (Id) ON DELETE CASCADE
        );
        """);

    dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_Recipes_RecipeType ON Recipes (RecipeType);");
    dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_RecipeItems_RecipeId_FieldKey ON RecipeItems (RecipeId, FieldKey);");
}

static void EnsureEfficiencyTables(ScadaDbContext dbContext)
{
    dbContext.Database.ExecuteSqlRaw("""
        CREATE TABLE IF NOT EXISTS EfficiencyTimelineSegments (
            Id TEXT NOT NULL CONSTRAINT PK_EfficiencyTimelineSegments PRIMARY KEY,
            FaceplateIndex INTEGER NOT NULL,
            StationName TEXT NOT NULL,
            State TEXT NOT NULL,
            StartedAt TEXT NOT NULL,
            EndedAt TEXT NOT NULL,
            UpdatedAt TEXT NOT NULL,
            IsDemo INTEGER NOT NULL DEFAULT 0
        );
        """);

    dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_EfficiencyTimelineSegments_FaceplateIndex_StartedAt ON EfficiencyTimelineSegments (FaceplateIndex, StartedAt);");
    dbContext.Database.ExecuteSqlRaw("CREATE INDEX IF NOT EXISTS IX_EfficiencyTimelineSegments_FaceplateIndex_EndedAt ON EfficiencyTimelineSegments (FaceplateIndex, EndedAt);");
}

static void EnsureDeviceSchema(ScadaDbContext dbContext)
{
    using var command = dbContext.Database.GetDbConnection().CreateCommand();
    if (command.Connection?.State != System.Data.ConnectionState.Open)
    {
        command.Connection?.Open();
    }

    command.CommandText = "PRAGMA table_info('Devices');";
    using var reader = command.ExecuteReader();
    var columns = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    while (reader.Read())
    {
        columns.Add(reader.GetString(1));
    }

    if (!columns.Contains("DriverKind"))
    {
        dbContext.Database.ExecuteSqlRaw("ALTER TABLE Devices ADD COLUMN DriverKind TEXT NOT NULL DEFAULT 'OpcUa';");
    }
}

public partial class Program;

