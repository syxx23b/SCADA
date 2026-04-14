using Microsoft.EntityFrameworkCore;
using Microsoft.Data.Sqlite;
using Scada.Api.Data;
using Scada.Api.Hubs;
using Scada.Api.Services;
using Scada.Api.Services.Startup;
using Scada.OpcUa.Abstractions;
using Scada.OpcUa.Services;

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
builder.Services.AddSingleton<IOpcUaSessionClientFactory, OpcUaSessionClientFactory>();
builder.Services.AddSingleton<IScadaRuntimeCoordinator, ScadaRuntimeCoordinator>();
builder.Services.AddScoped<ISingleTagWriteCoordinator, SingleTagWriteCoordinator>();
builder.Services.AddSingleton<IBatchWriteCoordinator, BatchWriteCoordinator>();
builder.Services.AddHostedService<StartupConnectionInitializerHostedService>();

var app = builder.Build();

app.Logger.LogInformation("Using SQLite database at {DatabasePath}", new SqliteConnectionStringBuilder(scadaConnectionString).DataSource);

app.UseCors();

app.UseAuthorization();
app.UseDefaultFiles();
app.UseStaticFiles();

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


public partial class Program;
