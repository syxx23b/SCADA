using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;

namespace Scada.Api.Services.Startup;

public sealed class StartupConnectionInitializerHostedService : BackgroundService
{
    private static readonly TimeSpan RetryInterval = TimeSpan.FromSeconds(5);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;
    private readonly ILogger<StartupConnectionInitializerHostedService> _logger;

    public StartupConnectionInitializerHostedService(
        IServiceScopeFactory scopeFactory,
        IScadaRuntimeCoordinator runtimeCoordinator,
        ILogger<StartupConnectionInitializerHostedService> logger)
    {
        _scopeFactory = scopeFactory;
        _runtimeCoordinator = runtimeCoordinator;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await using var initScope = _scopeFactory.CreateAsyncScope();
        var initDbContext = initScope.ServiceProvider.GetRequiredService<ScadaDbContext>();
        await initDbContext.Database.EnsureCreatedAsync(stoppingToken);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await EnsureAutoConnectedDevicesAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Auto-connect sweep failed.");
            }

            try
            {
                await Task.Delay(RetryInterval, stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
        }
    }

    private async Task EnsureAutoConnectedDevicesAsync(CancellationToken cancellationToken)
    {
        await using var scope = _scopeFactory.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();

        var autoConnectDevices = await dbContext.Devices
            .Include(item => item.Tags)
            .Where(item => item.AutoConnect)
            .ToListAsync(cancellationToken);

        foreach (var device in autoConnectDevices)
        {
            if (_runtimeCoordinator.IsConnectionHealthy(device.Id))
            {
                continue;
            }

            try
            {
                await _runtimeCoordinator.ConnectAsync(device, device.Tags.Where(tag => tag.Enabled).ToArray(), cancellationToken);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Failed to auto-connect device {DeviceName}.", device.Name);
            }
        }
    }
}
