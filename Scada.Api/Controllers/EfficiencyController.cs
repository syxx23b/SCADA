using Microsoft.AspNetCore.Mvc;
using Scada.Api.Dtos;
using Scada.Api.Services;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/efficiency")]
public sealed class EfficiencyController : ControllerBase
{
    private readonly IEfficiencyAnalysisService _efficiencyAnalysisService;

    public EfficiencyController(IEfficiencyAnalysisService efficiencyAnalysisService)
    {
        _efficiencyAnalysisService = efficiencyAnalysisService;
    }

    [HttpGet("timeline")]
    public async Task<ActionResult<EfficiencyTimelineResponseDto>> GetTimeline(
        [FromQuery] int hours = 24,
        CancellationToken cancellationToken = default)
    {
        var timeline = await _efficiencyAnalysisService.GetTimelineAsync(hours, cancellationToken);
        return Ok(timeline);
    }
}
