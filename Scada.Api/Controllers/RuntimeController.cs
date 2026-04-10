using Microsoft.AspNetCore.Mvc;
using Scada.Api.Dtos;
using Scada.Api.Services;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/runtime")]
public sealed class RuntimeController : ControllerBase
{
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;

    public RuntimeController(IScadaRuntimeCoordinator runtimeCoordinator)
    {
        _runtimeCoordinator = runtimeCoordinator;
    }

    [HttpGet("overview")]
    public async Task<ActionResult<RuntimeOverviewDto>> GetOverview(CancellationToken cancellationToken)
    {
        var overview = await _runtimeCoordinator.GetRuntimeOverviewAsync(cancellationToken);
        return Ok(overview);
    }
}
