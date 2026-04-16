namespace Scada.Api.Services;

public sealed class EfficiencyTimelineCollectorHostedService : BackgroundService
{
    private static readonly TimeSpan CaptureInterval = TimeSpan.FromSeconds(30);

    private readonly IEfficiencyAnalysisService _efficiencyAnalysisService;
    private readonly ILogger<EfficiencyTimelineCollectorHostedService> _logger;

    public EfficiencyTimelineCollectorHostedService(
        IEfficiencyAnalysisService efficiencyAnalysisService,
        ILogger<EfficiencyTimelineCollectorHostedService> logger)
    {
        _efficiencyAnalysisService = efficiencyAnalysisService;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        using var timer = new PeriodicTimer(CaptureInterval);

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await _efficiencyAnalysisService.CaptureCurrentStateAsync(stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                break;
            }
            catch (Exception exception)
            {
                _logger.LogWarning(exception, "Failed to capture efficiency timeline snapshot.");
            }

            if (!await timer.WaitForNextTickAsync(stoppingToken))
            {
                break;
            }
        }
    }
}
