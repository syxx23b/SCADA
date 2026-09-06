using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/production/upload-insert-audits")]
public sealed class UploadInsertAuditsController : ControllerBase
{
    private readonly ScadaDbContext _dbContext;

    public UploadInsertAuditsController(ScadaDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<UploadInsertAuditDto>>> Get(CancellationToken cancellationToken)
    {
        var cutoff = DateTimeOffset.UtcNow.AddMonths(-1);
        var rows = await _dbContext.UploadInsertAudits
            .AsNoTracking()
            .Where(item => item.CreatedAt >= cutoff)
            .OrderByDescending(item => item.CreatedAt)
            .Take(500)
            .Select(item => new UploadInsertAuditDto(
                item.Id,
                item.StationIndex,
                item.TriggerKind,
                item.TargetTable,
                item.DisplayName,
                item.Tm,
                item.Gw,
                item.OrderNo,
                item.Mode,
                item.CreatedAt))
            .ToListAsync(cancellationToken);

        return Ok(rows);
    }
}

public sealed record UploadInsertAuditDto(
    long Id,
    int StationIndex,
    string TriggerKind,
    string TargetTable,
    string DisplayName,
    string? Tm,
    int? Gw,
    string? OrderNo,
    int? Mode,
    DateTimeOffset CreatedAt);
