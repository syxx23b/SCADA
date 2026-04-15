using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/[controller]")]
public sealed class RecipesController : ControllerBase
{
    private readonly ScadaDbContext _dbContext;

    public RecipesController(ScadaDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    // GET: api/recipes?type=DJ
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<RecipeDto>>> GetRecipes(
        [FromQuery] string? type = null,
        CancellationToken cancellationToken = default)
    {
        var query = _dbContext.Recipes.AsNoTracking();

        if (!string.IsNullOrWhiteSpace(type))
        {
            query = query.Where(r => r.RecipeType == type);
        }

        var recipes = await query
            .Select(r => r.ToDto())
            .ToListAsync(cancellationToken);

        return Ok(recipes.OrderByDescending(r => r.UpdatedAt).ToList());
    }

    // GET: api/recipes/{id}
    [HttpGet("{id:guid}")]
    public async Task<ActionResult<RecipeDetailDto>> GetRecipe(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var recipe = await _dbContext.Recipes
            .AsNoTracking()
            .Include(r => r.Items)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (recipe == null)
        {
            return NotFound();
        }

        var items = recipe.Items.ToDictionary(
            item => item.FieldKey,
            item => item.Value);

        return Ok(new RecipeDetailDto(
            recipe.Id,
            recipe.Name,
            recipe.Description,
            recipe.RecipeType,
            recipe.CreatedAt,
            recipe.UpdatedAt,
            items));
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

        // 检查同名配方是否已存在
        var existingRecipe = await _dbContext.Recipes
            .FirstOrDefaultAsync(r => r.Name == request.Name && r.RecipeType == request.RecipeType, cancellationToken);

        if (existingRecipe != null)
        {
            return Conflict($"已存在名为 '{request.Name}' 的配方");
        }

        var recipe = new RecipeEntity
        {
            Id = Guid.NewGuid(),
            Name = request.Name.Trim(),
            Description = request.Description?.Trim() ?? string.Empty,
            RecipeType = request.RecipeType.Trim().ToUpper(),
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
            Items = request.Items?.Select(kv => new RecipeItemEntity
            {
                Id = Guid.NewGuid(),
                FieldKey = kv.Key,
                Value = kv.Value
            }).ToList() ?? []
        };

        _dbContext.Recipes.Add(recipe);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return CreatedAtAction(nameof(GetRecipe), new { id = recipe.Id }, recipe.ToDto());
    }

    // PUT: api/recipes/{id}
    [HttpPut("{id:guid}")]
    public async Task<ActionResult<RecipeDto>> UpdateRecipe(
        Guid id,
        [FromBody] UpdateRecipeRequest request,
        CancellationToken cancellationToken = default)
    {
        var recipe = await _dbContext.Recipes
            .Include(r => r.Items)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (recipe == null)
        {
            return NotFound();
        }

        // 更新基本信息
        if (!string.IsNullOrWhiteSpace(request.Name))
        {
            recipe.Name = request.Name.Trim();
        }
        recipe.Description = request.Description?.Trim() ?? recipe.Description;
        recipe.UpdatedAt = DateTimeOffset.UtcNow;

        // 更新配方项
        if (request.Items != null)
        {
            // 删除旧的配方项
            _dbContext.RecipeItems.RemoveRange(recipe.Items);
            recipe.Items.Clear();

            // 添加新的配方项
            foreach (var kv in request.Items)
            {
                recipe.Items.Add(new RecipeItemEntity
                {
                    Id = Guid.NewGuid(),
                    RecipeId = recipe.Id,
                    FieldKey = kv.Key,
                    Value = kv.Value
                });
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        return Ok(recipe.ToDto());
    }

    // DELETE: api/recipes/{id}
    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteRecipe(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var recipe = await _dbContext.Recipes
            .Include(r => r.Items)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (recipe == null)
        {
            return NotFound();
        }

        if (recipe.Items.Count > 0)
        {
            _dbContext.RecipeItems.RemoveRange(recipe.Items);
        }

        _dbContext.Recipes.Remove(recipe);
        await _dbContext.SaveChangesAsync(cancellationToken);

        return NoContent();
    }


    // GET: api/recipes/{id}/items
    [HttpGet("{id:guid}/items")]
    public async Task<ActionResult<Dictionary<string, string>>> GetRecipeItems(
        Guid id,
        CancellationToken cancellationToken = default)
    {
        var recipe = await _dbContext.Recipes
            .AsNoTracking()
            .Include(r => r.Items)
            .FirstOrDefaultAsync(r => r.Id == id, cancellationToken);

        if (recipe == null)
        {
            return NotFound();
        }

        var items = recipe.Items.ToDictionary(
            item => item.FieldKey,
            item => item.Value);

        return Ok(items);
    }
}
