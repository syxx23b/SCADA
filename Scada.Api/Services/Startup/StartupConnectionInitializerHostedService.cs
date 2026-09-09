using System.Collections.Concurrent;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;

namespace Scada.Api.Services.Startup;

public sealed class StartupConnectionInitializerHostedService : BackgroundService
{
    private static readonly TimeSpan RetryBaseInterval = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan RetryMaxInterval = TimeSpan.FromHours(1);
    private static readonly TimeSpan SweepInterval = TimeSpan.FromSeconds(5);

    private readonly IServiceScopeFactory _scopeFactory;
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;
    private readonly ILogger<StartupConnectionInitializerHostedService> _logger;
    private readonly ConcurrentDictionary<Guid, DeviceRetryState> _retryStates = new();

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
                await Task.Delay(SweepInterval, stoppingToken);
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

        // 清理已不存在的设备的重试状态。
        var seenIds = new HashSet<Guid>(autoConnectDevices.Select(item => item.Id));
        foreach (var staleId in _retryStates.Keys.Where(id => !seenIds.Contains(id)).ToArray())
        {
            _retryStates.TryRemove(staleId, out _);
        }

        var now = DateTimeOffset.UtcNow;
        foreach (var device in autoConnectDevices)
        {
            if (_runtimeCoordinator.IsConnectionHealthy(device.Id))
            {
                // 已连接:重置退避状态。
                _retryStates.TryRemove(device.Id, out _);
                continue;
            }

            if (_retryStates.TryGetValue(device.Id, out var state) && state.NextAttemptUtc > now)
            {
                // 未到下次重试时间:指数退避,跳过本轮。
                continue;
            }

            try
            {
                await _runtimeCoordinator.ConnectAsync(device, device.Tags.Where(tag => tag.Enabled).ToArray(), cancellationToken);
                _retryStates.TryRemove(device.Id, out _);
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Failed to auto-connect device {DeviceName}.", device.Name);
                var attemptCount = (state?.AttemptCount ?? 0) + 1;
                var delay = NextRetryDelay(attemptCount);
                _retryStates[device.Id] = new DeviceRetryState(now + delay, attemptCount);
            }
        }
    }

    private static TimeSpan NextRetryDelay(int attemptCount)
    {
        // 指数退避:5s * 2^(n-1),封顶 1 小时。
        var seconds = RetryBaseInterval.TotalSeconds * Math.Pow(2, attemptCount - 1);
        return TimeSpan.FromSeconds(Math.Min(seconds, RetryMaxInterval.TotalSeconds));
    }

    private sealed record DeviceRetryState(DateTimeOffset NextAttemptUtc, int AttemptCount);
}
