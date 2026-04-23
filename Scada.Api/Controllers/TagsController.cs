using System.Text;
using ClosedXML.Excel;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using Scada.Api.Data;
using Scada.Api.Domain;
using Scada.Api.Dtos;
using Scada.Api.Services;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/tags")]
public sealed class TagsController : ControllerBase
{
    private readonly ScadaDbContext _dbContext;
    private readonly IScadaRuntimeCoordinator _runtimeCoordinator;
    private readonly ISingleTagWriteCoordinator _singleTagWriteCoordinator;
    private readonly TagSnapshotCache _tagSnapshotCache;
    private readonly ISiemensDbTagImportService _siemensDbTagImportService;

    public TagsController(
        ScadaDbContext dbContext,
        IScadaRuntimeCoordinator runtimeCoordinator,
        ISingleTagWriteCoordinator singleTagWriteCoordinator,
        TagSnapshotCache tagSnapshotCache,
        ISiemensDbTagImportService siemensDbTagImportService)
    {
        _dbContext = dbContext;
        _runtimeCoordinator = runtimeCoordinator;
        _singleTagWriteCoordinator = singleTagWriteCoordinator;
        _tagSnapshotCache = tagSnapshotCache;
        _siemensDbTagImportService = siemensDbTagImportService;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<TagDefinitionDto>>> GetTags([FromQuery] Guid? deviceId, CancellationToken cancellationToken)
    {
        var query = _dbContext.Tags.AsQueryable();
        if (deviceId.HasValue)
        {
            query = query.Where(item => item.DeviceId == deviceId.Value);
        }

        var tags = await query.OrderBy(item => item.DisplayName).ToListAsync(cancellationToken);
        return Ok(tags.Select(item => item.ToDto()).ToArray());
    }

    [HttpPost]
    public async Task<ActionResult<TagDefinitionDto>> CreateTag([FromBody] UpsertTagRequest request, CancellationToken cancellationToken)
    {
        var sanitized = ScadaInputSanitizer.NormalizeTag(request);
        var device = await _dbContext.Devices.FirstOrDefaultAsync(item => item.Id == sanitized.DeviceId, cancellationToken);

        if (device is null)
        {
            return NotFound("Device was not found.");
        }

        var entity = new TagDefinitionEntity
        {
            DeviceId = sanitized.DeviceId,
            NodeId = sanitized.NodeId,
            BrowseName = sanitized.BrowseName,
            DisplayName = sanitized.DisplayName,
            DataType = sanitized.DataType,
            SamplingIntervalMs = sanitized.SamplingIntervalMs,
            PublishingIntervalMs = sanitized.PublishingIntervalMs,
            AllowWrite = sanitized.AllowWrite,
            Enabled = sanitized.Enabled,
            GroupKey = sanitized.GroupKey
        };

        _dbContext.Tags.Add(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var deviceTags = await _dbContext.Tags.Where(item => item.DeviceId == sanitized.DeviceId && item.Enabled).ToListAsync(cancellationToken);
        await _runtimeCoordinator.RefreshSubscriptionsAsync(device, deviceTags, cancellationToken);

        return CreatedAtAction(nameof(GetTags), new { id = entity.Id }, entity.ToDto());
    }

    [HttpPut("{id:guid}")]
    public async Task<ActionResult<TagDefinitionDto>> UpdateTag(Guid id, [FromBody] UpsertTagRequest request, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Tags.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var sanitized = ScadaInputSanitizer.NormalizeTag(request);
        entity.NodeId = sanitized.NodeId;
        entity.BrowseName = sanitized.BrowseName;
        entity.DisplayName = sanitized.DisplayName;
        entity.DataType = sanitized.DataType;
        entity.SamplingIntervalMs = sanitized.SamplingIntervalMs;
        entity.PublishingIntervalMs = sanitized.PublishingIntervalMs;
        entity.AllowWrite = sanitized.AllowWrite;
        entity.Enabled = sanitized.Enabled;
        entity.GroupKey = sanitized.GroupKey;
        entity.UpdatedAt = DateTimeOffset.UtcNow;

        await _dbContext.SaveChangesAsync(cancellationToken);

        var device = await _dbContext.Devices.FirstAsync(item => item.Id == entity.DeviceId, cancellationToken);
        var deviceTags = await _dbContext.Tags.Where(item => item.DeviceId == entity.DeviceId && item.Enabled).ToListAsync(cancellationToken);
        await _runtimeCoordinator.RefreshSubscriptionsAsync(device, deviceTags, cancellationToken);

        return Ok(entity.ToDto());
    }

    [HttpDelete("{id:guid}")]
    public async Task<IActionResult> DeleteTag(Guid id, CancellationToken cancellationToken)
    {
        var entity = await _dbContext.Tags.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (entity is null)
        {
            return NotFound();
        }

        var device = await _dbContext.Devices.FirstAsync(item => item.Id == entity.DeviceId, cancellationToken);
        var deviceId = entity.DeviceId;
        var tagId = entity.Id;

        _dbContext.Tags.Remove(entity);
        await _dbContext.SaveChangesAsync(cancellationToken);

        var deviceTags = await _dbContext.Tags.Where(item => item.DeviceId == deviceId && item.Enabled).ToListAsync(cancellationToken);
        await _runtimeCoordinator.RefreshSubscriptionsAsync(device, deviceTags, cancellationToken);
        _tagSnapshotCache.Remove(tagId);

        return NoContent();
    }

    [HttpPost("{id:guid}/write")]
    public async Task<ActionResult<WriteOperationResultDto>> WriteTag(Guid id, [FromBody] WriteTagValueRequest request, CancellationToken cancellationToken)
    {
        var tag = await _dbContext.Tags.FirstOrDefaultAsync(item => item.Id == id, cancellationToken);
        if (tag is null)
        {
            return NotFound();
        }

        var device = await _dbContext.Devices.FirstAsync(item => item.Id == tag.DeviceId, cancellationToken);
        var result = await _singleTagWriteCoordinator.WriteAsync(device, tag, request, cancellationToken);
        return Ok(result);
    }

    [HttpGet("export/excel")]
    public async Task<IActionResult> ExportAllTagsExcel(CancellationToken cancellationToken)
    {
        var rawRows = await _dbContext.Tags
            .AsNoTracking()
            .Join(
                _dbContext.Devices.AsNoTracking(),
                tag => tag.DeviceId,
                device => device.Id,
                (tag, device) => new
                {
                    DeviceId = device.Id,
                    DeviceName = IsLocalGroupKey(tag.GroupKey) ? "Local" : device.Name,
                    DriverKind = device.DriverKind,
                    tag.DisplayName,
                    tag.BrowseName,
                    tag.NodeId,
                    tag.DataType,
                    tag.GroupKey,
                    tag.SamplingIntervalMs,
                    tag.PublishingIntervalMs,
                    tag.AllowWrite,
                    tag.Enabled
                })
            .ToListAsync(cancellationToken);

        var rows = rawRows
            .Select(item => new TagExcelRow(
                item.DeviceId,
                IsLocalGroupKey(item.GroupKey) ? "Local" : item.DeviceName,
                item.DriverKind.ToString(),
                item.DisplayName,
                item.BrowseName,
                item.NodeId,
                item.DataType,
                item.GroupKey,
                item.SamplingIntervalMs,
                item.PublishingIntervalMs,
                item.AllowWrite,
                item.Enabled))
            .OrderBy(item => item.DeviceName)
            .ThenBy(item => item.GroupKey)
            .ThenBy(item => item.DisplayName)
            .ToList();

        using var workbook = new XLWorkbook();
        var worksheet = workbook.Worksheets.Add("Tags");
        var headers = new[]
        {
            "DeviceName",
            "DriverKind",
            "DeviceId",
            "DisplayName",
            "BrowseName",
            "NodeId",
            "DataType",
            "GroupKey",
            "SamplingIntervalMs",
            "PublishingIntervalMs",
            "AllowWrite",
            "Enabled"
        };

        for (var column = 0; column < headers.Length; column++)
        {
            worksheet.Cell(1, column + 1).Value = headers[column];
        }

        for (var index = 0; index < rows.Count; index++)
        {
            var row = rows[index];
            var targetRow = index + 2;
            worksheet.Cell(targetRow, 1).Value = row.DeviceName;
            worksheet.Cell(targetRow, 2).Value = row.DriverKind;
            worksheet.Cell(targetRow, 3).Value = row.DeviceId.ToString();
            worksheet.Cell(targetRow, 4).Value = row.DisplayName;
            worksheet.Cell(targetRow, 5).Value = row.BrowseName;
            worksheet.Cell(targetRow, 6).Value = row.NodeId;
            worksheet.Cell(targetRow, 7).Value = row.DataType;
            worksheet.Cell(targetRow, 8).Value = row.GroupKey ?? string.Empty;
            worksheet.Cell(targetRow, 9).Value = row.SamplingIntervalMs;
            worksheet.Cell(targetRow, 10).Value = row.PublishingIntervalMs;
            worksheet.Cell(targetRow, 11).Value = row.AllowWrite;
            worksheet.Cell(targetRow, 12).Value = row.Enabled;
        }

        var range = worksheet.Range(1, 1, Math.Max(rows.Count + 1, 2), headers.Length);
        range.CreateTable();
        worksheet.SheetView.FreezeRows(1);
        worksheet.Columns().AdjustToContents();

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return File(
            stream.ToArray(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"subscription_tags_{DateTimeOffset.Now:yyyyMMdd_HHmmss}.xlsx");
    }

    [HttpPost("import/excel-replace")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<ActionResult<TagExcelReplaceResultDto>> ImportExcelReplaceAllTags([FromForm] IFormFile file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest("请上传 Excel 文件。");
        }

        List<TagExcelImportRow> rows;
        try
        {
            await using var stream = file.OpenReadStream();
            using var workbook = new XLWorkbook(stream);
            var worksheet = workbook.TryGetWorksheet("Tags", out var namedWorksheet)
                ? namedWorksheet
                : workbook.Worksheets.FirstOrDefault();
            if (worksheet is null)
            {
                return BadRequest("Excel 中未找到工作表。");
            }

            rows = ReadExcelRows(worksheet);
        }
        catch (Exception ex)
        {
            return BadRequest($"Excel 解析失败: {ex.Message}");
        }

        if (rows.Count == 0)
        {
            return BadRequest("Excel 中没有可导入的标签数据。");
        }

        var devices = await _dbContext.Devices.AsNoTracking().ToListAsync(cancellationToken);
        var errors = new List<string>();
        var importedTags = new List<TagDefinitionEntity>();

        for (var index = 0; index < rows.Count; index++)
        {
            var rowNumber = index + 2;
            var row = rows[index];

            if (string.IsNullOrWhiteSpace(row.DisplayName))
            {
                errors.Add($"第 {rowNumber} 行 DisplayName 不能为空。");
                continue;
            }

            var device = ResolveDevice(row, devices);
            if (device is null)
            {
                errors.Add($"第 {rowNumber} 行找不到设备: DeviceName={row.DeviceName}, DeviceId={row.DeviceId}。");
                continue;
            }

            try
            {
                var payload = ScadaInputSanitizer.NormalizeTag(new UpsertTagRequest(
                    device.Id,
                    row.NodeId ?? string.Empty,
                    row.BrowseName ?? string.Empty,
                    row.DisplayName,
                    row.DataType ?? "String",
                    row.SamplingIntervalMs ?? 500,
                    row.PublishingIntervalMs ?? 500,
                    row.AllowWrite ?? false,
                    row.Enabled ?? true,
                    row.GroupKey));

                importedTags.Add(new TagDefinitionEntity
                {
                    DeviceId = payload.DeviceId,
                    NodeId = payload.NodeId,
                    BrowseName = payload.BrowseName,
                    DisplayName = payload.DisplayName,
                    DataType = payload.DataType,
                    SamplingIntervalMs = payload.SamplingIntervalMs,
                    PublishingIntervalMs = payload.PublishingIntervalMs,
                    AllowWrite = payload.AllowWrite,
                    Enabled = payload.Enabled,
                    GroupKey = payload.GroupKey
                });
            }
            catch (Exception ex)
            {
                errors.Add($"第 {rowNumber} 行无效: {ex.Message}");
            }
        }

        if (errors.Count > 0)
        {
            return BadRequest(new TagExcelReplaceResultDto(rows.Count, 0, 0, errors));
        }

        var duplicateKeys = importedTags
            .GroupBy(item => $"{item.DeviceId:N}|{item.NodeId.Trim()}".ToUpperInvariant())
            .Where(group => group.Count() > 1)
            .Select(group => group.Key)
            .ToList();

        if (duplicateKeys.Count > 0)
        {
            var duplicateErrors = duplicateKeys
                .Select(item => $"存在重复 NodeId: {item}")
                .ToList();
            return BadRequest(new TagExcelReplaceResultDto(rows.Count, 0, 0, duplicateErrors));
        }

        var removed = await _dbContext.Tags.CountAsync(cancellationToken);
        await using var transaction = await _dbContext.Database.BeginTransactionAsync(cancellationToken);
        _dbContext.Tags.RemoveRange(_dbContext.Tags);
        await _dbContext.SaveChangesAsync(cancellationToken);
        _dbContext.Tags.AddRange(importedTags);
        await _dbContext.SaveChangesAsync(cancellationToken);
        await transaction.CommitAsync(cancellationToken);

        _tagSnapshotCache.Clear();

        foreach (var device in devices)
        {
            var deviceTags = importedTags.Where(item => item.DeviceId == device.Id && item.Enabled).ToList();
            await _runtimeCoordinator.RefreshSubscriptionsAsync(device, deviceTags, cancellationToken);
        }

        return Ok(new TagExcelReplaceResultDto(rows.Count, importedTags.Count, removed, []));
    }

    [HttpGet("export/local")]
    public async Task<IActionResult> ExportLocalTags(CancellationToken cancellationToken)
    {
        var localGroupKeys = new[] { "Local", "Local Variable", "Device1_LocalVariable", "Local.RecipeDJ", "Local.RecipeQYJ" };
        var tags = await _dbContext.Tags
            .Where(item => localGroupKeys.Contains(item.GroupKey))
            .OrderBy(item => item.DisplayName)
            .ToListAsync(cancellationToken);

        var csv = new StringBuilder();
        csv.AppendLine("Id,DeviceId,DisplayName,BrowseName,NodeId,DataType,GroupKey,SamplingIntervalMs,PublishingIntervalMs,AllowWrite,Enabled");
        foreach (var tag in tags)
        {
            csv.AppendLine($"{tag.Id},{tag.DeviceId},{EscapeCsv(tag.DisplayName)},{EscapeCsv(tag.BrowseName)},{EscapeCsv(tag.NodeId)},{tag.DataType},{tag.GroupKey},{tag.SamplingIntervalMs},{tag.PublishingIntervalMs},{tag.AllowWrite},{tag.Enabled}");
        }

        var bytes = Encoding.UTF8.GetBytes(csv.ToString());
        return File(bytes, "text/csv; charset=utf-8", $"local_tags_{DateTimeOffset.Now:yyyyMMdd_HHmmss}.csv");
    }

    [HttpPost("import/local")]
    public async Task<ActionResult<TagImportResultDto>> ImportLocalTags([FromBody] TagImportRequest request, CancellationToken cancellationToken)
    {
        var total = request.Tags.Count;
        var updated = 0;
        var failed = 0;
        var errors = new List<string>();
        var localGroupKeys = new[] { "Local", "Local Variable", "Device1_LocalVariable", "Local.RecipeDJ", "Local.RecipeQYJ" };

        foreach (var tagUpdate in request.Tags)
        {
            try
            {
                var entity = await _dbContext.Tags.FirstOrDefaultAsync(item => item.Id == tagUpdate.Id, cancellationToken);
                if (entity is null)
                {
                    failed++;
                    errors.Add($"Tag {tagUpdate.Id} not found");
                    continue;
                }

                if (!localGroupKeys.Contains(entity.GroupKey))
                {
                    failed++;
                    errors.Add($"Tag {tagUpdate.Id} is not a local variable");
                    continue;
                }

                entity.DisplayName = tagUpdate.DisplayName;
                entity.BrowseName = tagUpdate.BrowseName ?? tagUpdate.DisplayName;
                if (!string.IsNullOrWhiteSpace(tagUpdate.NodeId))
                {
                    entity.NodeId = tagUpdate.NodeId;
                }
                if (!string.IsNullOrWhiteSpace(tagUpdate.DataType))
                {
                    entity.DataType = tagUpdate.DataType;
                }
                if (!string.IsNullOrWhiteSpace(tagUpdate.GroupKey))
                {
                    entity.GroupKey = tagUpdate.GroupKey;
                }
                entity.UpdatedAt = DateTimeOffset.UtcNow;

                updated++;
            }
            catch (Exception ex)
            {
                failed++;
                errors.Add($"Tag {tagUpdate.Id}: {ex.Message}");
            }
        }

        await _dbContext.SaveChangesAsync(cancellationToken);

        foreach (var deviceId in request.Tags.Select(t => t.DeviceId).Distinct())
        {
            var device = await _dbContext.Devices.FirstOrDefaultAsync(item => item.Id == deviceId, cancellationToken);
            if (device is not null)
            {
                var deviceTags = await _dbContext.Tags.Where(item => item.DeviceId == deviceId && item.Enabled).ToListAsync(cancellationToken);
                await _runtimeCoordinator.RefreshSubscriptionsAsync(device, deviceTags, cancellationToken);
            }
        }

        var result = new TagImportResultDto(total, updated, failed, errors);
        return Ok(result);
    }

    [HttpPost("import/siemens-db")]
    [RequestSizeLimit(10 * 1024 * 1024)]
    public async Task<ActionResult<SiemensDbImportPreviewDto>> ImportSiemensDbTags([FromForm] IFormFile file, CancellationToken cancellationToken)
    {
        if (file is null || file.Length == 0)
        {
            return BadRequest("请上传 Siemens DB 源文件。");
        }

        await using var stream = file.OpenReadStream();
        using var reader = new StreamReader(stream, Encoding.UTF8, detectEncodingFromByteOrderMarks: true);
        var sourceText = await reader.ReadToEndAsync(cancellationToken);
        var result = _siemensDbTagImportService.Parse(sourceText);
        return Ok(result);
    }

    private static string EscapeCsv(string? value)
    {
        if (string.IsNullOrEmpty(value))
            return "";
        if (value.Contains(',') || value.Contains('"') || value.Contains('\n'))
            return $"\"{value.Replace("\"", "\"\"")}\"";
        return value;
    }

    private static List<TagExcelImportRow> ReadExcelRows(IXLWorksheet worksheet)
    {
        var headerRow = worksheet.FirstRowUsed();
        if (headerRow is null)
        {
            return [];
        }

        var columnIndexByName = headerRow.CellsUsed()
            .ToDictionary(
                cell => cell.GetString().Trim(),
                cell => cell.Address.ColumnNumber,
                StringComparer.OrdinalIgnoreCase);

        string? ReadString(IXLRow row, string columnName)
        {
            return columnIndexByName.TryGetValue(columnName, out var columnIndex)
                ? row.Cell(columnIndex).GetString().Trim()
                : null;
        }

        double? ReadDouble(IXLRow row, string columnName)
        {
            var raw = ReadString(row, columnName);
            if (string.IsNullOrWhiteSpace(raw))
            {
                return null;
            }

            return double.TryParse(raw, out var value) ? value : null;
        }

        bool? ReadBool(IXLRow row, string columnName)
        {
            var raw = ReadString(row, columnName);
            if (string.IsNullOrWhiteSpace(raw))
            {
                return null;
            }

            if (bool.TryParse(raw, out var boolValue))
            {
                return boolValue;
            }

            if (raw == "1") return true;
            if (raw == "0") return false;
            return null;
        }

        var lastRowNumber = worksheet.LastRowUsed()?.RowNumber() ?? 1;
        var rows = new List<TagExcelImportRow>();
        for (var rowNumber = 2; rowNumber <= lastRowNumber; rowNumber++)
        {
            var row = worksheet.Row(rowNumber);
            var deviceName = ReadString(row, "DeviceName");
            var deviceId = ReadString(row, "DeviceId");
            var displayName = ReadString(row, "DisplayName");
            var nodeId = ReadString(row, "NodeId");
            var dataType = ReadString(row, "DataType");

            if (string.IsNullOrWhiteSpace(deviceName) &&
                string.IsNullOrWhiteSpace(deviceId) &&
                string.IsNullOrWhiteSpace(displayName) &&
                string.IsNullOrWhiteSpace(nodeId) &&
                string.IsNullOrWhiteSpace(dataType))
            {
                continue;
            }

            rows.Add(new TagExcelImportRow(
                deviceName,
                deviceId,
                ReadString(row, "BrowseName"),
                displayName ?? string.Empty,
                nodeId,
                dataType,
                ReadString(row, "GroupKey"),
                ReadDouble(row, "SamplingIntervalMs"),
                ReadDouble(row, "PublishingIntervalMs"),
                ReadBool(row, "AllowWrite"),
                ReadBool(row, "Enabled")));
        }

        return rows;
    }

    private static DeviceConnectionEntity? ResolveDevice(TagExcelImportRow row, IReadOnlyList<DeviceConnectionEntity> devices)
    {
        if (!string.IsNullOrWhiteSpace(row.DeviceId) && Guid.TryParse(row.DeviceId, out var deviceId))
        {
            var byId = devices.FirstOrDefault(item => item.Id == deviceId);
            if (byId is not null)
            {
                return byId;
            }
        }

        if (!string.IsNullOrWhiteSpace(row.DeviceName))
        {
            return devices.FirstOrDefault(item => string.Equals(item.Name, row.DeviceName, StringComparison.OrdinalIgnoreCase));
        }

        return null;
    }

    private static bool IsLocalGroupKey(string? groupKey)
    {
        if (string.IsNullOrWhiteSpace(groupKey))
        {
            return false;
        }

        var normalized = groupKey.Trim();
        return normalized.Equals("Local", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Local Variable", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Device1_LocalVariable", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Local.RecipeDJ", StringComparison.OrdinalIgnoreCase) ||
               normalized.Equals("Local.RecipeQYJ", StringComparison.OrdinalIgnoreCase);
    }

    private sealed record TagExcelRow(
        Guid DeviceId,
        string DeviceName,
        string DriverKind,
        string DisplayName,
        string BrowseName,
        string NodeId,
        string DataType,
        string? GroupKey,
        double SamplingIntervalMs,
        double PublishingIntervalMs,
        bool AllowWrite,
        bool Enabled);

    private sealed record TagExcelImportRow(
        string? DeviceName,
        string? DeviceId,
        string? BrowseName,
        string DisplayName,
        string? NodeId,
        string? DataType,
        string? GroupKey,
        double? SamplingIntervalMs,
        double? PublishingIntervalMs,
        bool? AllowWrite,
        bool? Enabled);
}
