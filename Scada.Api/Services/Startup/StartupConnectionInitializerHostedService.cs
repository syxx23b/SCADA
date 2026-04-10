using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;

namespace Scada.Api.Services.Startup;

public sealed class StartupConnectionInitializerHostedService : BackgroundService
{
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
        await using var scope = _scopeFactory.CreateAsyncScope();
        var dbContext = scope.ServiceProvider.GetRequiredService<ScadaDbContext>();
        await dbContext.Database.EnsureCreatedAsync(stoppingToken);

        var autoConnectDevices = await dbContext.Devices
            .Include(item => item.Tags)
            .Where(item => item.AutoConnect)
            .ToListAsync(stoppingToken);

        foreach (var device in autoConnectDevices)
        {
            try
            {
                await _runtimeCoordinator.ConnectAsync(device, device.Tags.Where(tag => tag.Enabled).ToArray(), stoppingToken);
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Failed to auto-connect device {DeviceName}.", device.Name);
            }
        }
    }
}
