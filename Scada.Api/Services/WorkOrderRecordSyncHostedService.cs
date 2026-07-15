using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;

namespace Scada.Api.Services;

public sealed class WorkOrderRecordSyncHostedService : BackgroundService
{
    private static readonly TimeSpan SyncInterval = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan RecordWindow = TimeSpan.FromDays(14);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IConfiguration _configuration;
    private readonly ILogger<WorkOrderRecordSyncHostedService> _logger;

    public WorkOrderRecordSyncHostedService(
        IServiceScopeFactory scopeFactory,
        IConfiguration configuration,
        ILogger<WorkOrderRecordSyncHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _configuration = configuration;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await SyncOnceAsync(stoppingToken);

        using var timer = new PeriodicTimer(SyncInterval);
        while (await timer.WaitForNextTickAsync(stoppingToken))
        {
            await SyncOnceAsync(stoppingToken);
        }
    }

    private async Task SyncOnceAsync(CancellationToken cancellationToken)
    {
        try
        {
            await using var scope = _scopeFactory.CreateAsyncScope();
            var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
            var workOrders = await dbContext.WorkOrders
                .Where(item => item.Status != WorkOrderStatuses.Archived)
                .ToListAsync(cancellationToken);

            if (workOrders.Count == 0)
            {
                return;
            }

            var now = DateTimeOffset.UtcNow;
            var changed = false;

            foreach (var workOrder in workOrders)
            {
                var completedQty = await QueryRecordCountAsync(workOrder.WorkOrderNo, cancellationToken);
                if (workOrder.CompletedQty != completedQty)
                {
                    workOrder.CompletedQty = completedQty;
                    workOrder.UpdatedAt = now;
                    changed = true;
                }

            }

            if (changed)
            {
                await dbContext.SaveChangesAsync(cancellationToken);
            }
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
            throw;
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to sync work order completed quantities from dbo.Record.");
        }
    }

    private async Task<int> QueryRecordCountAsync(string workOrderNo, CancellationToken cancellationToken)
    {
        if (string.IsNullOrWhiteSpace(workOrderNo))
        {
            return 0;
        }

        var connectionString = _configuration.GetConnectionString("MssqlRecordDb")
            ?? _configuration.GetConnectionString("ScadaDb")
            ?? throw new InvalidOperationException("Missing connection string: MssqlRecordDb or ScadaDb");

        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);

        var from = DateTime.Now.Subtract(RecordWindow);
        await using var command = new SqlCommand("""
            SELECT COUNT_BIG(1)
            FROM dbo.Record
            WHERE sj >= @from
              AND mode = 0
              AND orderNo = @orderNo;
            """, connection);
        command.Parameters.Add(new SqlParameter("@from", System.Data.SqlDbType.DateTime2) { Value = from });
        command.Parameters.Add(new SqlParameter("@orderNo", System.Data.SqlDbType.VarChar, 50) { Value = workOrderNo.Trim() });

        var count = Convert.ToInt64(await command.ExecuteScalarAsync(cancellationToken));
        return count > int.MaxValue ? int.MaxValue : Convert.ToInt32(count);
    }
}
