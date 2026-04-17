using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;

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
