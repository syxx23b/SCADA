namespace Scada.Api.Services;

public sealed class RecipeSubscriptionLeaseHostedService : BackgroundService
{
    private static readonly TimeSpan SweepInterval = TimeSpan.FromSeconds(5);

    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;
    private readonly ILogger<RecipeSubscriptionLeaseHostedService> _logger;

    public RecipeSubscriptionLeaseHostedService(
        IScadaRuntimeCoordinator runtimeCoordinator,
        ILogger<RecipeSubscriptionLeaseHostedService> logger)
    {
        _runtimeCoordinator = runtimeCoordinator;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _runtimeCoordinator.SweepRecipeSubscriptionLeasesAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Failed to sweep recipe subscription leases.");
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
}
