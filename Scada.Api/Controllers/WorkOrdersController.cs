using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;
using Scada.Api.Services;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/production/work-orders")]
public sealed class WorkOrdersController : ControllerBase
{
    private readonly ScadaDbContext _dbContext;
    private readonly ISingleTagWriteCoordinator _singleTagWriteCoordinator;

    public WorkOrdersController(
        ScadaDbContext dbContext,
        ISingleTagWriteCoordinator singleTagWriteCoordinator)
    {
        _dbContext = dbContext;
        _singleTagWriteCoordinator = singleTagWriteCoordinator;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<WorkOrderDto>>> GetWorkOrders(CancellationToken cancellationToken)
    {
        var workOrders = await _dbContext.WorkOrders
            .AsNoTracking()
            .OrderByDescending(item => item.Id)
            .Select(item => ToDto(item))
            .ToListAsync(cancellationToken);

        return Ok(workOrders);
    }

    [HttpPost]
    public async Task<ActionResult<WorkOrderDto>> CreateWorkOrder([FromBody] CreateWorkOrderRequest request, CancellationToken cancellationToken)
    {
        var productName = request.ProductName.Trim();
        if (string.IsNullOrWhiteSpace(productName))
        {
            return BadRequest("产品名称不能为空");
        }

        if (request.PlanQty <= 0)
        {
            return BadRequest("计划数量必须大于 0");
        }

        var workOrderNo = string.IsNullOrWhiteSpace(request.WorkOrderNo)
            ? GenerateWorkOrderNo()
            : request.WorkOrderNo.Trim();

        if (await _dbContext.WorkOrders.AnyAsync(item => item.WorkOrderNo == workOrderNo, cancellationToken))
        {
            return Conflict("工单编号已存在");
        }

        var now = DateTimeOffset.UtcNow;
        var entity = new WorkOrderEntity
        {
            WorkOrderNo = workOrderNo,
            ProductName = productName,
            PlanQty = request.PlanQty,
            CompletedQty = 0,
            Priority = NormalizePriority(request.Priority),
            Status = WorkOrderStatuses.Pending,
            DueDate = request.DueDate.Date,
            CreatedAt = now,
            UpdatedAt = now,
        };

        _dbContext.WorkOrders.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await ClearOrderNoTagsIfAllCurrentWorkOrdersPendingAsync(cancellationToken);

        return CreatedAtAction(nameof(GetWorkOrders), new { id = entity.Id }, ToDto(entity));
    }

    [HttpPut("{id:int}")]
    public async Task<ActionResult<WorkOrderDto>> UpdateWorkOrder(int id, [FromBody] UpdateWorkOrderRequest request, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.WorkOrders.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var productName = request.ProductName.Trim();
        if (string.IsNullOrWhiteSpace(productName))
        {
            return BadRequest("产品名称不能为空");
        }

        if (request.PlanQty <= 0)
        {
            return BadRequest("计划数量必须大于 0");
        }

        if (request.CompletedQty < 0)
        {
            return BadRequest("完工数量不能小于 0");
        }

        var normalizedStatus = NormalizeStatus(request.Status);
        if (normalizedStatus is null)
        {
            return BadRequest("工单状态无效");
        }

        if (normalizedStatus == WorkOrderStatuses.Running && await HasOtherRunningWorkOrderAsync(id, cancellationToken))
        {
            return Conflict("已有工单处于执行中");
        }

        entity.ProductName = productName;
        entity.PlanQty = request.PlanQty;
        entity.CompletedQty = Math.Min(request.CompletedQty, request.PlanQty);
        entity.Priority = NormalizePriority(request.Priority);
        entity.Status = normalizedStatus;
        entity.DueDate = request.DueDate.Date;
        entity.ArchivedAt = normalizedStatus == WorkOrderStatuses.Archived
            ? entity.ArchivedAt ?? DateTimeOffset.UtcNow
            : null;
        entity.UpdatedAt = DateTimeOffset.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        await ClearOrderNoTagsIfAllCurrentWorkOrdersPendingAsync(cancellationToken);
        return Ok(ToDto(entity));
    }

    [HttpPut("{id:int}/status")]
    public async Task<ActionResult<WorkOrderDto>> UpdateWorkOrderStatus(int id, [FromBody] UpdateWorkOrderStatusRequest request, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.WorkOrders.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var normalizedStatus = NormalizeStatus(request.Status);
        if (normalizedStatus is null)
        {
            return BadRequest("工单状态无效");
        }

        if (normalizedStatus == WorkOrderStatuses.Running && await HasOtherRunningWorkOrderAsync(id, cancellationToken))
        {
            return Conflict("已有工单处于执行中");
        }

        entity.Status = normalizedStatus;
        entity.ArchivedAt = normalizedStatus == WorkOrderStatuses.Archived
            ? entity.ArchivedAt ?? DateTimeOffset.UtcNow
            : null;
        entity.UpdatedAt = DateTimeOffset.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);
        await ClearOrderNoTagsIfAllCurrentWorkOrdersPendingAsync(cancellationToken);
        return Ok(ToDto(entity));
    }

    [HttpDelete("{id:int}")]
    public async Task<IActionResult> DeleteWorkOrder(int id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.WorkOrders.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        if (entity.Status != WorkOrderStatuses.Pending)
        {
            return Conflict("仅待执行工单允许删除");
        }

        _dbContext.WorkOrders.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await ClearOrderNoTagsIfAllCurrentWorkOrdersPendingAsync(cancellationToken);
        return NoContent();
    }

    private async Task<bool> HasOtherRunningWorkOrderAsync(int id, CancellationToken cancellationToken)
    {
        return await _dbContext.WorkOrders.AnyAsync(
            item => item.Id != id && item.Status == WorkOrderStatuses.Running,
            cancellationToken);
    }

    private static string GenerateWorkOrderNo()
    {
        return $"WO-{DateTime.Now:yyyyMMdd-HHmmss}";
    }

    private static int NormalizePriority(int value)
    {
        return Math.Max(1, Math.Min(99, value));
    }

    private static string? NormalizeStatus(string value)
    {
        var normalized = value.Trim();
        return WorkOrderStatuses.IsValid(normalized) ? normalized : null;
    }

    private static WorkOrderDto ToDto(WorkOrderEntity entity)
    {
        return new WorkOrderDto(
            entity.Id,
            entity.WorkOrderNo,
            entity.ProductName,
            entity.PlanQty,
            entity.CompletedQty,
            entity.Priority,
            entity.Status,
            entity.DueDate,
            entity.ArchivedAt,
            entity.CreatedAt,
            entity.UpdatedAt);
    }

    private async Task ClearOrderNoTagsIfAllCurrentWorkOrdersPendingAsync(CancellationToken cancellationToken)
    {
        var hasNonPendingCurrentWorkOrder = await _dbContext.WorkOrders.AnyAsync(
            item => item.Status != WorkOrderStatuses.Archived && item.Status != WorkOrderStatuses.Pending,
            cancellationToken);

        if (hasNonPendingCurrentWorkOrder)
        {
            return;
        }

        var localTags = await _dbContext.Tags
            .Where(item => item.GroupKey == "Local")
            .ToListAsync(cancellationToken);

        var orderNoTags = localTags
            .Select(tag => new { Tag = tag, Index = GetLocalOrderNoIndex(tag) })
            .Where(item => item.Index >= 1 && item.Index <= 50)
            .OrderBy(item => item.Index)
            .ToList();

        if (orderNoTags.Count != 50)
        {
            throw new InvalidOperationException($"Local OrderNo tag count is {orderNoTags.Count}; expected 50.");
        }

        var deviceIds = orderNoTags.Select(item => item.Tag.DeviceId).Distinct().ToArray();
        var devices = await _dbContext.Devices
            .Where(item => deviceIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, cancellationToken);

        foreach (var item in orderNoTags)
        {
            if (!devices.TryGetValue(item.Tag.DeviceId, out var device))
            {
                throw new InvalidOperationException($"Device {item.Tag.DeviceId} for {item.Tag.DisplayName} was not found.");
            }

            var result = await _singleTagWriteCoordinator.WriteAsync(
                device,
                item.Tag,
                new WriteTagValueRequest(string.Empty),
                cancellationToken);

            if (!result.Succeeded)
            {
                throw new InvalidOperationException(result.Message ?? $"Failed to clear {item.Tag.DisplayName}.");
            }
        }
    }

    private static int GetLocalOrderNoIndex(TagDefinitionEntity tag)
    {
        if (!string.Equals(tag.GroupKey?.Trim(), "Local", StringComparison.OrdinalIgnoreCase))
        {
            return -1;
        }

        foreach (var candidate in new[] { tag.DisplayName, tag.BrowseName, tag.NodeId })
        {
            var index = TryReadOrderNoIndex(candidate);
            if (index > 0)
            {
                return index;
            }
        }

        return -1;
    }

    private static int TryReadOrderNoIndex(string? value)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return -1;
        }

        var text = value.Trim();
        var bracketStart = text.LastIndexOf("OrderNo[", StringComparison.OrdinalIgnoreCase);
        if (bracketStart >= 0 && text.EndsWith(']'))
        {
            var start = bracketStart + "OrderNo[".Length;
            var length = text.Length - start - 1;
            return int.TryParse(text.Substring(start, length), out var index) ? index : -1;
        }

        var underscoreStart = text.LastIndexOf("OrderNo_", StringComparison.OrdinalIgnoreCase);
        if (underscoreStart >= 0)
        {
            var start = underscoreStart + "OrderNo_".Length;
            return int.TryParse(text[start..], out var index) ? index : -1;
        }

        return -1;
    }
}
