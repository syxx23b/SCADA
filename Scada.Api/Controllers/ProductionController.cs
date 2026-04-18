using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using System.Globalization;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/production")]
public sealed class ProductionController : ControllerBase
{
    private readonly string _connectionString;
    private readonly ILogger<ProductionController> _logger;

    public ProductionController(IConfiguration configuration, ILogger<ProductionController> logger)
    {
        _connectionString = configuration.GetConnectionString("MssqlRecordDb")
            ?? throw new InvalidOperationException("Missing connection string: MssqlRecordDb");
        _logger = logger;
    }

    [HttpGet("today-gw")]
    public async Task<ActionResult<ProductionByGwResponseDto>> GetTodayByGw(CancellationToken cancellationToken)
    {
        const string todaySql = """
            SELECT gw, COUNT_BIG(1) AS Cnt
            FROM dbo.Record
            WHERE mode = 0
              AND gw > 0
              AND sj >= CAST(GETDATE() AS date)
              AND sj < DATEADD(day, 1, CAST(GETDATE() AS date))
            GROUP BY gw
            ORDER BY gw;
            """;

        var buckets = new List<ProductionByGwBucketDto>();
        var dailyLast30Years = new List<ProductionByDateBucketDto>();
        var monthlyLast12Months = new List<ProductionByMonthBucketDto>();

        try
        {
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            await using (var todayCommand = new SqlCommand(todaySql, connection))
            {
                await using var reader = await todayCommand.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var gw = reader.GetInt32(0);
                    var count = Convert.ToInt32(reader.GetInt64(1));
                    buckets.Add(new ProductionByGwBucketDto(gw, count));
                }
            }

            const string dailySql = """
                SELECT CONVERT(char(10), CAST(sj AS date), 23) AS [DayKey], COUNT_BIG(1) AS Cnt
                FROM dbo.Record
                WHERE mode = 0
                  AND gw > 0
                  AND sj >= DATEADD(day, -30, CAST(GETDATE() AS date))
                  AND sj < DATEADD(day, 1, CAST(GETDATE() AS date))
                GROUP BY CAST(sj AS date)
                ORDER BY CAST(sj AS date) DESC;
                """;

            await using (var dailyCommand = new SqlCommand(dailySql, connection))
            {
                await using var reader = await dailyCommand.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var date = reader.GetString(0);
                    var count = Convert.ToInt32(reader.GetInt64(1));
                    dailyLast30Years.Add(new ProductionByDateBucketDto(date, count));
                }
            }

            const string monthlySql = """
                SELECT CONVERT(char(7), sj, 120) AS [MonthKey], COUNT_BIG(1) AS Cnt
                FROM dbo.Record
                WHERE mode = 0
                  AND gw > 0
                  AND sj >= DATEADD(month, -11, DATEFROMPARTS(YEAR(GETDATE()), MONTH(GETDATE()), 1))
                  AND sj < DATEADD(day, 1, CAST(GETDATE() AS date))
                GROUP BY YEAR(sj), MONTH(sj), CONVERT(char(7), sj, 120)
                ORDER BY YEAR(sj) DESC, MONTH(sj) DESC;
                """;

            await using (var monthlyCommand = new SqlCommand(monthlySql, connection))
            {
                await using var reader = await monthlyCommand.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var month = reader.GetString(0);
                    var count = Convert.ToInt32(reader.GetInt64(1));
                    monthlyLast12Months.Add(new ProductionByMonthBucketDto(month, count));
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query production statistics from MSSQL");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "产量统计查询失败" });
        }

        var now = DateTimeOffset.Now;
        var response = new ProductionByGwResponseDto(
            now.Date.ToString("yyyy-MM-dd"),
            buckets.Sum(item => item.Count),
            buckets,
            dailyLast30Years,
            monthlyLast12Months,
            now.ToString("O"));

        return Ok(response);
    }

    [HttpGet("fault-today-gw")]
    public async Task<ActionResult<FaultByGwResponseDto>> GetTodayFaultByGw(CancellationToken cancellationToken)
    {
        const string todayQualifiedSql = """
            SELECT gw, COUNT_BIG(1) AS Cnt
            FROM dbo.Record
            WHERE mode = 0
              AND gw > 0
              AND sj >= CAST(GETDATE() AS date)
              AND sj < DATEADD(day, 1, CAST(GETDATE() AS date))
            GROUP BY gw
            ORDER BY gw;
            """;

        const string todayFaultSql = """
            SELECT gw, COUNT_BIG(1) AS Cnt
            FROM dbo.[Error]
            WHERE gw > 0
              AND [ERR] > 0
              AND sj >= CAST(GETDATE() AS date)
              AND sj < DATEADD(day, 1, CAST(GETDATE() AS date))
            GROUP BY gw
            ORDER BY gw;
            """;

        const string quarterErrorSql = """
            SELECT CONVERT(char(10), CAST(sj AS date), 23) AS [DayKey], [ERR], COUNT_BIG(1) AS Cnt
            FROM dbo.[Error]
            WHERE gw > 0
              AND [ERR] > 0
              AND sj >= DATEADD(month, -3, CAST(GETDATE() AS date))
              AND sj < DATEADD(day, 1, CAST(GETDATE() AS date))
            GROUP BY CAST(sj AS date), [ERR]
            ORDER BY CAST(sj AS date) DESC, [ERR] ASC;
            """;

        const string quarterQualifiedSql = """
            SELECT CONVERT(char(10), CAST(sj AS date), 23) AS [DayKey], COUNT_BIG(1) AS Cnt
            FROM dbo.Record
            WHERE mode = 0
              AND gw > 0
              AND sj >= DATEADD(month, -3, CAST(GETDATE() AS date))
              AND sj < DATEADD(day, 1, CAST(GETDATE() AS date))
            GROUP BY CAST(sj AS date)
            ORDER BY CAST(sj AS date) DESC;
            """;

        var faultBuckets = new List<ProductionByGwBucketDto>();
        var qualifiedBuckets = new List<ProductionByGwBucketDto>();
        var quarterErrorDetails = new List<FaultQuarterBucketDto>();
        var quarterQualifiedDetails = new List<ProductionByDateBucketDto>();

        try
        {
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            await using (var qualifiedCommand = new SqlCommand(todayQualifiedSql, connection))
            {
                await using var reader = await qualifiedCommand.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var gw = reader.GetInt32(0);
                    var count = Convert.ToInt32(reader.GetInt64(1));
                    qualifiedBuckets.Add(new ProductionByGwBucketDto(gw, count));
                }
            }

            await using (var command = new SqlCommand(todayFaultSql, connection))
            {
                await using var faultReader = await command.ExecuteReaderAsync(cancellationToken);
                while (await faultReader.ReadAsync(cancellationToken))
                {
                    var gw = faultReader.GetInt32(0);
                    var count = Convert.ToInt32(faultReader.GetInt64(1));
                    faultBuckets.Add(new ProductionByGwBucketDto(gw, count));
                }
            }

            await using (var quarterCommand = new SqlCommand(quarterErrorSql, connection))
            {
                await using var quarterReader = await quarterCommand.ExecuteReaderAsync(cancellationToken);
                while (await quarterReader.ReadAsync(cancellationToken))
                {
                    var date = quarterReader.GetString(0);
                    var err = Convert.ToInt32(quarterReader.GetValue(1));
                    var count = Convert.ToInt32(quarterReader.GetInt64(2));
                    quarterErrorDetails.Add(new FaultQuarterBucketDto(date, err, count));
                }
            }

            await using (var quarterQualifiedCommand = new SqlCommand(quarterQualifiedSql, connection))
            {
                await using var quarterQualifiedReader = await quarterQualifiedCommand.ExecuteReaderAsync(cancellationToken);
                while (await quarterQualifiedReader.ReadAsync(cancellationToken))
                {
                    var date = quarterQualifiedReader.GetString(0);
                    var count = Convert.ToInt32(quarterQualifiedReader.GetInt64(1));
                    quarterQualifiedDetails.Add(new ProductionByDateBucketDto(date, count));
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query fault statistics from MSSQL");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "故障分析查询失败" });
        }

        var now = DateTimeOffset.Now;
        var response = new FaultByGwResponseDto(
            now.Date.ToString("yyyy-MM-dd"),
            faultBuckets.Sum(item => item.Count),
            qualifiedBuckets.Sum(item => item.Count),
            faultBuckets,
            qualifiedBuckets,
            quarterErrorDetails,
            quarterQualifiedDetails,
            now.ToString("O"));

        return Ok(response);
    }

    [HttpGet("factory-test-report")]
    public async Task<ActionResult<FactoryTestReportResponseDto>> GetFactoryTestReport(
        [FromQuery] DateTime from,
        [FromQuery] DateTime to,
        [FromQuery] int? gw,
        [FromQuery] string? orderNo,
        CancellationToken cancellationToken)
    {
        if (from > to)
        {
            return BadRequest(new { message = "起始时间不能大于结束时间" });
        }

        const int maxRows = 2000;
        var excludedColumns = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "ID", "mode", "tmJS" };
        const string countSql = """
            SELECT COUNT_BIG(1)
            FROM dbo.Record
            WHERE sj >= @from
              AND sj <= @to
              AND mode = 0
              AND (@gw IS NULL OR [gw] = @gw)
              AND (@orderNo IS NULL OR LTRIM(RTRIM(CONVERT(nvarchar(100), [OrderNo]))) = @orderNo);
            """;

        const string rowsSql = """
            SELECT TOP (@maxRows) *
            FROM dbo.Record
            WHERE sj >= @from
              AND sj <= @to
              AND mode = 0
              AND (@gw IS NULL OR [gw] = @gw)
              AND (@orderNo IS NULL OR LTRIM(RTRIM(CONVERT(nvarchar(100), [OrderNo]))) = @orderNo)
            ORDER BY sj DESC;
            """;

        var columns = new List<string>();
        var rows = new List<Dictionary<string, string?>>();
        int totalCount;

        try
        {
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            await using (var countCommand = new SqlCommand(countSql, connection))
            {
                countCommand.Parameters.AddWithValue("@from", from);
                countCommand.Parameters.AddWithValue("@to", to);
                countCommand.Parameters.AddWithValue("@gw", gw.HasValue ? gw.Value : DBNull.Value);
                var normalizedOrderNo = string.IsNullOrWhiteSpace(orderNo) ? null : orderNo.Trim();
                countCommand.Parameters.AddWithValue("@orderNo", normalizedOrderNo is null ? DBNull.Value : normalizedOrderNo);
                totalCount = Convert.ToInt32(await countCommand.ExecuteScalarAsync(cancellationToken) ?? 0L);
            }

            await using var rowsCommand = new SqlCommand(rowsSql, connection);
            rowsCommand.Parameters.AddWithValue("@from", from);
            rowsCommand.Parameters.AddWithValue("@to", to);
            rowsCommand.Parameters.AddWithValue("@gw", gw.HasValue ? gw.Value : DBNull.Value);
            var rowsOrderNo = string.IsNullOrWhiteSpace(orderNo) ? null : orderNo.Trim();
            rowsCommand.Parameters.AddWithValue("@orderNo", rowsOrderNo is null ? DBNull.Value : rowsOrderNo);
            rowsCommand.Parameters.AddWithValue("@maxRows", maxRows);

            await using var reader = await rowsCommand.ExecuteReaderAsync(cancellationToken);
            for (var i = 0; i < reader.FieldCount; i++)
            {
                var columnName = reader.GetName(i);
                if (!excludedColumns.Contains(columnName))
                {
                    columns.Add(columnName);
                }
            }

            while (await reader.ReadAsync(cancellationToken))
            {
                var row = new Dictionary<string, string?>(reader.FieldCount, StringComparer.OrdinalIgnoreCase);
                for (var i = 0; i < reader.FieldCount; i++)
                {
                    var name = reader.GetName(i);
                    if (excludedColumns.Contains(name))
                    {
                        continue;
                    }
                    if (reader.IsDBNull(i))
                    {
                        row[name] = null;
                        continue;
                    }

                    var value = reader.GetValue(i);
                    row[name] = value switch
                    {
                        DateTime dateTime => dateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                        DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                        _ => Convert.ToString(value, CultureInfo.InvariantCulture)
                    };
                }
                rows.Add(row);
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query factory test report from MSSQL");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "出厂测试报表查询失败" });
        }

        var now = DateTimeOffset.Now;
        return Ok(new FactoryTestReportResponseDto(
            from.ToString("yyyy-MM-dd HH:mm:ss"),
            to.ToString("yyyy-MM-dd HH:mm:ss"),
            totalCount,
            rows.Count,
            totalCount > rows.Count,
            columns,
            rows,
            now.ToString("O")));
    }
}

public sealed record ProductionByGwBucketDto(int Gw, int Count);
public sealed record ProductionByDateBucketDto(string Date, int Count);
public sealed record ProductionByMonthBucketDto(string Month, int Count);

public sealed record ProductionByGwResponseDto(
    string Date,
    int TotalCount,
    IReadOnlyList<ProductionByGwBucketDto> Buckets,
    IReadOnlyList<ProductionByDateBucketDto> DailyLast30Years,
    IReadOnlyList<ProductionByMonthBucketDto> MonthlyLast12Months,
    string GeneratedAt);

public sealed record FaultByGwResponseDto(
    string Date,
    int TotalFaultCount,
    int TotalQualifiedCount,
    IReadOnlyList<ProductionByGwBucketDto> FaultBuckets,
    IReadOnlyList<ProductionByGwBucketDto> QualifiedBuckets,
    IReadOnlyList<FaultQuarterBucketDto> QuarterErrorDetails,
    IReadOnlyList<ProductionByDateBucketDto> QuarterQualifiedDetails,
    string GeneratedAt);

public sealed record FaultQuarterBucketDto(
    string Date,
    int Err,
    int Count);

public sealed record FactoryTestReportResponseDto(
    string From,
    string To,
    int TotalCount,
    int ReturnedCount,
    bool IsTruncated,
    IReadOnlyList<string> Columns,
    IReadOnlyList<Dictionary<string, string?>> Rows,
    string GeneratedAt);
