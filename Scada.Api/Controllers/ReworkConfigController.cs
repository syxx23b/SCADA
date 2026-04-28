using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Scada.Api.Services;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/rework-config")]
public sealed class ReworkConfigController : ControllerBase
{
    private readonly string _connectionString;
    private readonly ILogger<ReworkConfigController> _logger;

    public ReworkConfigController(IConfiguration configuration, ILogger<ReworkConfigController> logger)
    {
        _connectionString = configuration.GetConnectionString("MssqlRecordDb")
            ?? throw new InvalidOperationException("Missing connection string: MssqlRecordDb");
        _logger = logger;
    }

    [HttpGet("graph")]
    public async Task<ActionResult<ReworkConfigGraphResponseDto>> GetGraph(CancellationToken cancellationToken)
    {
        var errNodes = new List<ReworkErrNodeDto>();
        var measureNodes = new List<ReworkMeasureNodeDto>();
        var edges = new List<ReworkMappingEdgeDto>();

        const string errSql = """
            SELECT ERR, ERRinformation
            FROM dbo.ErrorDefine
            WHERE ERR > 0
            ORDER BY ERR ASC;
            """;

        const string measureSql = """
            SELECT ID, ItemContent
            FROM dbo.ReworkKnowledgeItem
            WHERE ItemType = 2
            ORDER BY ID ASC;
            """;

        const string edgeSql = """
            SELECT M.ID, M.ERR, M.KnowledgeID
            FROM dbo.ErrKnowledgeMap AS M
            INNER JOIN dbo.ReworkKnowledgeItem AS K ON K.ID = M.KnowledgeID
            WHERE K.ItemType = 2
            ORDER BY M.ERR ASC, M.SortOrder ASC, M.ID ASC;
            """;

        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            await using (var command = new SqlCommand(errSql, connection))
            {
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var err = Convert.ToInt32(reader.GetValue(0));
                    var errInformation = reader.IsDBNull(1) ? $"ERR{err}" : reader.GetString(1).Trim();
                    errNodes.Add(new ReworkErrNodeDto(err, errInformation));
                }
            }

            await using (var command = new SqlCommand(measureSql, connection))
            {
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    measureNodes.Add(new ReworkMeasureNodeDto(reader.GetInt64(0), reader.GetString(1).Trim()));
                }
            }

            await using (var command = new SqlCommand(edgeSql, connection))
            {
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    edges.Add(new ReworkMappingEdgeDto(reader.GetInt64(0), Convert.ToInt32(reader.GetValue(1)), reader.GetInt64(2)));
                }
            }

            return Ok(new ReworkConfigGraphResponseDto(errNodes, measureNodes, edges));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query rework graph");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "返修组态图谱查询失败" });
        }
    }

    [HttpGet("entries/{err:int}")]
    public async Task<ActionResult<ReworkConfigEntriesResponseDto>> GetEntries(int err, CancellationToken cancellationToken)
    {
        if (err <= 0) return BadRequest(new { message = "ERR 必须大于 0" });

        var suggestions = new List<ReworkSuggestionRowDto>();
        var measures = new List<ReworkMeasureMappingRowDto>();
        var measureCatalog = new List<ReworkMeasureNodeDto>();

        const string suggestionSql = """
            SELECT ID, ItemContent
            FROM dbo.ErrReworkSuggestion
            WHERE ERR = @err
            ORDER BY SortOrder ASC, ID ASC;
            """;

        const string measureMapSql = """
            SELECT M.ID, K.ID, K.ItemContent
            FROM dbo.ErrKnowledgeMap AS M
            INNER JOIN dbo.ReworkKnowledgeItem AS K ON K.ID = M.KnowledgeID
            WHERE M.ERR = @err AND K.ItemType = 2
            ORDER BY M.SortOrder ASC, M.ID ASC;
            """;

        const string measureCatalogSql = """
            SELECT ID, ItemContent
            FROM dbo.ReworkKnowledgeItem
            WHERE ItemType = 2
            ORDER BY ID ASC;
            """;

        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            await using (var command = new SqlCommand(suggestionSql, connection))
            {
                command.Parameters.AddWithValue("@err", err);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    suggestions.Add(new ReworkSuggestionRowDto(reader.GetInt64(0), reader.GetString(1).Trim()));
                }
            }

            await using (var command = new SqlCommand(measureMapSql, connection))
            {
                command.Parameters.AddWithValue("@err", err);
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    measures.Add(new ReworkMeasureMappingRowDto(reader.GetInt64(0), reader.GetInt64(1), reader.GetString(2).Trim()));
                }
            }

            await using (var command = new SqlCommand(measureCatalogSql, connection))
            {
                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    measureCatalog.Add(new ReworkMeasureNodeDto(reader.GetInt64(0), reader.GetString(1).Trim()));
                }
            }

            return Ok(new ReworkConfigEntriesResponseDto(err, suggestions, measures, measureCatalog));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query rework entries");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "返修组态列表查询失败" });
        }
    }

    [HttpPost("suggestions")]
    public async Task<ActionResult<ReworkSuggestionRowDto>> CreateSuggestion(
        [FromBody] CreateSuggestionRequest request,
        CancellationToken cancellationToken)
    {
        var content = request.ItemContent?.Trim();
        if (request.Err <= 0) return BadRequest(new { message = "ERR 必须大于 0" });
        if (string.IsNullOrWhiteSpace(content)) return BadRequest(new { message = "返修建议内容不能为空" });

        const string sql = """
            INSERT INTO dbo.ErrReworkSuggestion(ERR, ItemContent, SortOrder)
            OUTPUT INSERTED.ID, INSERTED.ItemContent
            SELECT @err, @itemContent, ISNULL(MAX(SortOrder), 0) + 1
            FROM dbo.ErrReworkSuggestion
            WHERE ERR = @err;
            """;

        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new SqlCommand(sql, connection);
            command.Parameters.AddWithValue("@err", request.Err);
            command.Parameters.AddWithValue("@itemContent", content);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                return Ok(new ReworkSuggestionRowDto(reader.GetInt64(0), reader.GetString(1).Trim()));
            }

            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "新增返修建议失败" });
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        {
            return Conflict(new { message = "该 ERR 下已存在相同返修建议" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create suggestion");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "新增返修建议失败" });
        }
    }

    [HttpDelete("suggestions/{id:long}")]
    public async Task<IActionResult> DeleteSuggestion(long id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { message = "建议 ID 无效" });

        const string sql = """
            DELETE FROM dbo.ErrReworkSuggestion
            WHERE ID = @id;
            """;

        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new SqlCommand(sql, connection);
            command.Parameters.AddWithValue("@id", id);
            var affected = await command.ExecuteNonQueryAsync(cancellationToken);
            if (affected <= 0) return NotFound(new { message = "返修建议不存在" });
            return NoContent();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete suggestion");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "删除返修建议失败" });
        }
    }

    [HttpPost("measures")]
    public async Task<ActionResult<ReworkMeasureNodeDto>> CreateMeasure(
        [FromBody] CreateMeasureRequest request,
        CancellationToken cancellationToken)
    {
        var content = request.ItemContent?.Trim();
        if (string.IsNullOrWhiteSpace(content)) return BadRequest(new { message = "维修措施内容不能为空" });

        const string sql = """
            INSERT INTO dbo.ReworkKnowledgeItem(ItemType, ItemContent)
            OUTPUT INSERTED.ID, INSERTED.ItemContent
            VALUES(2, @itemContent);
            """;

        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new SqlCommand(sql, connection);
            command.Parameters.AddWithValue("@itemContent", content);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                return Ok(new ReworkMeasureNodeDto(reader.GetInt64(0), reader.GetString(1).Trim()));
            }
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "新增维修措施失败" });
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        {
            return Conflict(new { message = "已存在相同维修措施" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create measure");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "新增维修措施失败" });
        }
    }

    [HttpDelete("measures/{id:long}")]
    public async Task<IActionResult> DeleteMeasure(long id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { message = "措施 ID 无效" });

        const string refSql = """
            SELECT COUNT_BIG(1)
            FROM dbo.ErrKnowledgeMap
            WHERE KnowledgeID = @id;
            """;

        const string deleteSql = """
            DELETE FROM dbo.ReworkKnowledgeItem
            WHERE ID = @id AND ItemType = 2;
            """;

        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            await using (var refCommand = new SqlCommand(refSql, connection))
            {
                refCommand.Parameters.AddWithValue("@id", id);
                var refCount = Convert.ToInt64(await refCommand.ExecuteScalarAsync(cancellationToken) ?? 0L);
                if (refCount > 0) return Conflict(new { message = "该维修措施仍被映射，请先删除匹配关系" });
            }

            await using (var deleteCommand = new SqlCommand(deleteSql, connection))
            {
                deleteCommand.Parameters.AddWithValue("@id", id);
                var affected = await deleteCommand.ExecuteNonQueryAsync(cancellationToken);
                if (affected <= 0) return NotFound(new { message = "维修措施不存在" });
            }

            return NoContent();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete measure");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "删除维修措施失败" });
        }
    }

    [HttpPost("mappings")]
    public async Task<ActionResult<ReworkMappingEdgeDto>> CreateMapping(
        [FromBody] CreateMeasureMappingRequest request,
        CancellationToken cancellationToken)
    {
        if (request.Err <= 0 || request.KnowledgeId <= 0)
        {
            return BadRequest(new { message = "ERR 与 KnowledgeID 必须为正整数" });
        }

        const string typeSql = """
            SELECT ItemType
            FROM dbo.ReworkKnowledgeItem
            WHERE ID = @knowledgeId;
            """;

        const string insertSql = """
            INSERT INTO dbo.ErrKnowledgeMap(ERR, KnowledgeID, SortOrder)
            OUTPUT INSERTED.ID, INSERTED.ERR, INSERTED.KnowledgeID
            SELECT @err, @knowledgeId, ISNULL(MAX(SortOrder), 0) + 1
            FROM dbo.ErrKnowledgeMap
            WHERE ERR = @err;
            """;

        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            await using (var typeCommand = new SqlCommand(typeSql, connection))
            {
                typeCommand.Parameters.AddWithValue("@knowledgeId", request.KnowledgeId);
                var itemTypeValue = await typeCommand.ExecuteScalarAsync(cancellationToken);
                if (itemTypeValue is null) return BadRequest(new { message = "措施节点不存在" });
                var itemType = Convert.ToInt32(itemTypeValue);
                if (itemType != 2) return BadRequest(new { message = "仅允许映射维修措施节点" });
            }

            await using var insertCommand = new SqlCommand(insertSql, connection);
            insertCommand.Parameters.AddWithValue("@err", request.Err);
            insertCommand.Parameters.AddWithValue("@knowledgeId", request.KnowledgeId);
            await using var reader = await insertCommand.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                return Ok(new ReworkMappingEdgeDto(reader.GetInt64(0), Convert.ToInt32(reader.GetValue(1)), reader.GetInt64(2)));
            }

            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "新增匹配关系失败" });
        }
        catch (SqlException ex) when (ex.Number is 2601 or 2627)
        {
            return Conflict(new { message = "该 ERR 与维修措施已存在匹配关系" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to create measure mapping");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "新增匹配关系失败" });
        }
    }

    [HttpDelete("mappings/{id:long}")]
    public async Task<IActionResult> DeleteMapping(long id, CancellationToken cancellationToken)
    {
        if (id <= 0) return BadRequest(new { message = "匹配关系 ID 无效" });

        const string sql = """
            DELETE FROM dbo.ErrKnowledgeMap
            WHERE ID = @id;
            """;

        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new SqlCommand(sql, connection);
            command.Parameters.AddWithValue("@id", id);
            var affected = await command.ExecuteNonQueryAsync(cancellationToken);
            if (affected <= 0) return NotFound(new { message = "匹配关系不存在" });
            return NoContent();
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to delete mapping");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "删除匹配关系失败" });
        }
    }
}

public sealed record ReworkConfigGraphResponseDto(
    IReadOnlyList<ReworkErrNodeDto> ErrNodes,
    IReadOnlyList<ReworkMeasureNodeDto> MeasureNodes,
    IReadOnlyList<ReworkMappingEdgeDto> Edges);

public sealed record ReworkErrNodeDto(
    int Err,
    string ErrInformation);

public sealed record ReworkMeasureNodeDto(
    long Id,
    string ItemContent);

public sealed record ReworkMappingEdgeDto(
    long Id,
    int Err,
    long KnowledgeId);

public sealed record ReworkConfigEntriesResponseDto(
    int Err,
    IReadOnlyList<ReworkSuggestionRowDto> Suggestions,
    IReadOnlyList<ReworkMeasureMappingRowDto> Measures,
    IReadOnlyList<ReworkMeasureNodeDto> MeasureCatalog);

public sealed record ReworkSuggestionRowDto(
    long Id,
    string ItemContent);

public sealed record ReworkMeasureMappingRowDto(
    long MappingId,
    long KnowledgeId,
    string ItemContent);

public sealed record CreateSuggestionRequest(
    int Err,
    string ItemContent);

public sealed record CreateMeasureRequest(
    string ItemContent);

public sealed record CreateMeasureMappingRequest(
    int Err,
    long KnowledgeId);
