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

// 确保数据库及配方表已创建
using (var scope = app.Services.CreateScope())
{
    var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
    dbContext.Database.EnsureCreated();
    EnsureRecipeTables(dbContext);
    app.Logger.LogInformation("Database initialized successfully");
}

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

public partial class Program;
