using Microsoft.AspNetCore.Mvc;
using Scada.Api.Services;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/recipe-subscriptions")]
public sealed class RecipeSubscriptionsController : ControllerBase
{
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;

    public RecipeSubscriptionsController(IScadaRuntimeCoordinator runtimeCoordinator)
    {
        _runtimeCoordinator = runtimeCoordinator;
    }

    [HttpPost("lease")]
    public async Task<IActionResult> TouchLease(
        [FromBody] RecipeSubscriptionLeaseRequest request,
        CancellationToken cancellationToken)
    {
        var scope = string.IsNullOrWhiteSpace(request.Scope) ? "default" : request.Scope.Trim();
        var seconds = Math.Clamp(request.DurationSeconds, 5, 120);
        await _runtimeCoordinator.TouchRecipeSubscriptionLeaseAsync(scope, TimeSpan.FromSeconds(seconds), cancellationToken);
        return NoContent();
    }
}
