using System.Data;
using System.Globalization;
using System.Text;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

namespace Scada.Api.Controllers;

/// <summary>
/// “数据记录”查询接口：替代已删除的上传审计体系，
/// 直接按时间/工位/类别/条码(订单号包含匹配)查询 dbo.Record(成品) 与 dbo.[Error](故障) 两张生产数据表。
/// 两张表均无 EF DbSet，使用 Microsoft.Data.SqlClient 参数化裸 SQL，全部参数化防注入。
/// </summary>
[ApiController]
[Route("api/production/data-records")]
public sealed class DataRecordsController : ControllerBase
{
    private const int DefaultLimit = 500;
    private const int MaxLimit = 2000;
    private const int DefaultWindowDays = 31;

    private const string KindRecord = "Record";
    private const string KindError = "Error";

    private const string FinishedRecordsSql = """
        SELECT TOP (@limit)
            sj,
            gw,
            [orderNo],
            model,
            mode
        FROM dbo.Record
        WHERE sj >= @from
          AND sj <= @to
          AND (@station IS NULL OR gw = @station)
          AND (@pattern IS NULL OR [orderNo] LIKE @pattern ESCAPE '\')
        ORDER BY sj DESC;
        """;

    private const string FaultRecordsSql = """
        SELECT TOP (@limit)
            E.sj,
            E.gw,
            E.[orderNo],
            E.model,
            E.mode,
            E.[ERR],
            D.ERRinformation
        FROM dbo.[Error] AS E
        LEFT JOIN ErrRepaire.ErrorDefine AS D ON D.ERR = E.[ERR]
        WHERE E.sj >= @from
          AND E.sj <= @to
          AND (@station IS NULL OR E.gw = @station)
          AND (@pattern IS NULL OR E.[orderNo] LIKE @pattern ESCAPE '\')
        ORDER BY E.sj DESC;
        """;

    private readonly string _connectionString;
    private readonly ILogger<DataRecordsController> _logger;

    public DataRecordsController(IConfiguration configuration, ILogger<DataRecordsController> logger)
    {
        _connectionString = configuration.GetConnectionString("MssqlRecordDb")
            ?? throw new InvalidOperationException("Missing connection string: MssqlRecordDb");
        _logger = logger;
    }

    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<DataRecordDto>>> Get(
        [FromQuery] string? from,
        [FromQuery] string? to,
        [FromQuery] string? station,
        [FromQuery] string? kind,
        [FromQuery] string? orderNo,
        [FromQuery] string? limit,
        CancellationToken cancellationToken)
    {
        // 时间窗口：缺省 = 当前本地时间往前推 31 天；解析失败则忽略该参数、退回默认值。
        var now = DateTime.Now;
        var fromTime = TryParseLocalDateTime(from) ?? now.AddDays(-DefaultWindowDays);
        var toTime = TryParseLocalDateTime(to) ?? now;

        // 工位：可空 int，解析失败视为未传(不过滤)。
        var stationFilter = int.TryParse(station, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedStation)
            ? parsedStation
            : (int?)null;

        // 数量：默认 500，越界收敛到 [1, 2000]。
        var safeLimit = int.TryParse(limit, NumberStyles.Integer, CultureInfo.InvariantCulture, out var parsedLimit)
            ? Math.Clamp(parsedLimit, 1, MaxLimit)
            : DefaultLimit;

        // 类别：空/非法 一律视为“全部”(两张表都查)；Record/Error 大小写不敏感。
        var kindFilter = kind?.Trim();
        var includeRecords = string.IsNullOrEmpty(kindFilter)
            || kindFilter.Equals(KindRecord, StringComparison.OrdinalIgnoreCase);
        var includeErrors = string.IsNullOrEmpty(kindFilter)
            || kindFilter.Equals(KindError, StringComparison.OrdinalIgnoreCase);

        // 条码/订单号包含匹配：对 orderNo 列做 LIKE，通配符转义为字面量，避免对列套函数。
        var orderNoFilter = string.IsNullOrWhiteSpace(orderNo) ? null : orderNo.Trim();
        var likePattern = orderNoFilter is null
            ? null
            : "%" + EscapeLikePattern(orderNoFilter) + "%";

        var candidates = new List<(DateTime? Sj, DataRecordDto Row)>(safeLimit * 2);
        try
        {
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            if (includeRecords)
            {
                await using var command = new SqlCommand(FinishedRecordsSql, connection);
                command.Parameters.AddWithValue("@from", fromTime);
                command.Parameters.AddWithValue("@to", toTime);
                command.Parameters.AddWithValue("@station", stationFilter.HasValue ? stationFilter.Value : DBNull.Value);
                command.Parameters.AddWithValue("@pattern", likePattern is null ? DBNull.Value : likePattern);
                command.Parameters.AddWithValue("@limit", safeLimit);

                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var sj = ReadNullableDateTime(reader, 0);
                    candidates.Add((sj, new DataRecordDto(
                        FormatSj(sj),
                        ReadNullableInt32(reader, 1),
                        KindRecord,
                        ReadTrimmedString(reader, 2),
                        ReadTrimmedString(reader, 3),
                        ReadNullableInt32(reader, 4),
                        Err: null,
                        ErrText: null)));
                }
            }

            if (includeErrors)
            {
                await using var command = new SqlCommand(FaultRecordsSql, connection);
                command.Parameters.AddWithValue("@from", fromTime);
                command.Parameters.AddWithValue("@to", toTime);
                command.Parameters.AddWithValue("@station", stationFilter.HasValue ? stationFilter.Value : DBNull.Value);
                command.Parameters.AddWithValue("@pattern", likePattern is null ? DBNull.Value : likePattern);
                command.Parameters.AddWithValue("@limit", safeLimit);

                await using var reader = await command.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var sj = ReadNullableDateTime(reader, 0);
                    candidates.Add((sj, new DataRecordDto(
                        FormatSj(sj),
                        ReadNullableInt32(reader, 1),
                        KindError,
                        ReadTrimmedString(reader, 2),
                        ReadTrimmedString(reader, 3),
                        ReadNullableInt32(reader, 4),
                        ReadNullableInt32(reader, 5),
                        ReadTrimmedString(reader, 6))));
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query data records from dbo.Record / dbo.[Error]");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "数据记录查询失败" });
        }

        // 两表按 sj 倒序合并(空 sj 视为最小、排最后)，再截取 limit 条。
        var page = candidates
            .OrderByDescending(item => item.Sj)
            .Select(item => item.Row)
            .Take(safeLimit)
            .ToList();

        return Ok(page);
    }

    private static DateTime? TryParseLocalDateTime(string? text)
    {
        return DateTime.TryParse(text, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out var parsed)
            ? parsed
            : null;
    }

    private static DateTime? ReadNullableDateTime(SqlDataReader reader, int ordinal)
    {
        return reader.IsDBNull(ordinal) ? null : reader.GetDateTime(ordinal);
    }

    private static string? FormatSj(DateTime? sj)
    {
        return sj.HasValue
            ? sj.Value.ToString("yyyy-MM-ddTHH:mm:ss", CultureInfo.InvariantCulture)
            : null;
    }

    private static string? ReadTrimmedString(SqlDataReader reader, int ordinal)
    {
        if (reader.IsDBNull(ordinal))
        {
            return null;
        }

        var text = reader.GetString(ordinal).Trim();
        return text.Length == 0 ? null : text;
    }

    private static int? ReadNullableInt32(SqlDataReader reader, int ordinal)
    {
        return reader.IsDBNull(ordinal)
            ? null
            : Convert.ToInt32(reader.GetValue(ordinal), CultureInfo.InvariantCulture);
    }

    /// <summary>把用户输入中的 LIKE 通配符转义为字面量(配合 ESCAPE '\')，实现字面量包含匹配。</summary>
    private static string EscapeLikePattern(string value)
    {
        var builder = new StringBuilder(value.Length + 8);
        foreach (var ch in value)
        {
            if (ch is '\\' or '%' or '_' or '[' or ']')
            {
                builder.Append('\\');
            }

            builder.Append(ch);
        }

        return builder.ToString();
    }
}

public sealed record DataRecordDto(
    string? Sj,
    int? Gw,
    string Kind,
    string? OrderNo,
    string? Model,
    int? Mode,
    int? Err,
    string? ErrText);
