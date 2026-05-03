using Microsoft.AspNetCore.Mvc;
using Scada.Api.Dtos;
using Scada.Api.Services;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class RecipesController : ControllerBase
{
    private readonly IMssqlRecipeStore _recipeStore;

    public RecipesController(IMssqlRecipeStore recipeStore)
    {
        _recipeStore = recipeStore;
    }

    // GET: api/recipes?type=DJ
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<RecipeDto>>> GetRecipes(
        [FromQuery] string? type = null,
        CancellationToken cancellationToken = default)
    {
        var recipes = await _recipeStore.GetRecipesAsync(type, cancellationToken);
        return Ok(recipes);
    }

    // GET: api/recipes/{id}
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<RecipeDetailDto>> GetRecipe(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var recipe = await _recipeStore.GetRecipeAsync(id, cancellationToken);
        return recipe == null ? NotFound() : Ok(recipe);
    }

    // POST: api/recipes
    [HttpPost]
    public async Task<ActionResult<RecipeDto>> CreateRecipe(
        [FromBody] SaveRecipeRequest request,
        CancellationToken cancellationToken = default)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest("配方名称不能为空");
        }

        if (string.IsNullOrWhiteSpace(request.RecipeType))
        {
            return BadRequest("配方类型不能为空");
        }

        try
        {
            var recipe = await _recipeStore.CreateRecipeAsync(request, cancellationToken);
            return CreatedAtAction(nameof(GetRecipe), new { id = recipe.Id }, recipe);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict(exception.Message);
        }
    }

    // PUT: api/recipes/{id}
    [HttpPut("{id:guid}")]
    public async Task<ActionResult<RecipeDto>> UpdateRecipe(
        Guid id,
        [FromBody] UpdateRecipeRequest request,
        CancellationToken cancellationToken = default)
    {
        try
        {
            var recipe = await _recipeStore.UpdateRecipeAsync(id, request, cancellationToken);
            return recipe == null ? NotFound() : Ok(recipe);
        }
        catch (InvalidOperationException exception)
        {
            return Conflict(exception.Message);
        }
    }

    // DELETE: api/recipes/{id}
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteRecipe(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var deleted = await _recipeStore.DeleteRecipeAsync(id, cancellationToken);
        return deleted ? NoContent() : NotFound();
    }

    // GET: api/recipes/{id}/items
    [HttpGet("{id:guid}/items")]
    public async Task<ActionResult<Dictionary<string, string>>> GetRecipeItems(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var recipe = await _recipeStore.GetRecipeAsync(id, cancellationToken);
        return recipe == null ? NotFound() : Ok(recipe.Items);
    }
}
