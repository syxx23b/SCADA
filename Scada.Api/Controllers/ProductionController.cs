using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Scada.Api.Services;
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

        const string quarterErrorDefinitionSql = """
            SELECT ERR, ERRinformation
            FROM dbo.ErrorDefine
            WHERE ERR > 0
            ORDER BY ERR ASC;
            """;

        var faultBuckets = new List<ProductionByGwBucketDto>();
        var qualifiedBuckets = new List<ProductionByGwBucketDto>();
        var quarterErrorDefinitions = new List<FaultErrorDefinitionDto>();
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

            await using (var quarterErrorDefinitionCommand = new SqlCommand(quarterErrorDefinitionSql, connection))
            {
                await using var quarterErrorDefinitionReader = await quarterErrorDefinitionCommand.ExecuteReaderAsync(cancellationToken);
                while (await quarterErrorDefinitionReader.ReadAsync(cancellationToken))
                {
                    var err = Convert.ToInt32(quarterErrorDefinitionReader.GetValue(0));
                    var information = quarterErrorDefinitionReader.IsDBNull(1)
                        ? $"ERR{err}"
                        : quarterErrorDefinitionReader.GetString(1);
                    quarterErrorDefinitions.Add(new FaultErrorDefinitionDto(err, information));
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
            quarterErrorDefinitions,
            quarterErrorDetails,
            quarterQualifiedDetails,
            now.ToString("O"));

        return Ok(response);
    }

    [HttpGet("rework-latest")]
    public async Task<ActionResult<ReworkLookupResponseDto>> GetLatestReworkByTm(
        [FromQuery] string? tm,
        CancellationToken cancellationToken)
    {
        var normalizedTm = tm?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedTm))
        {
            return BadRequest(new { message = "请输入返修字符串" });
        }

        const string sql = """
            SELECT TOP (1)
                E.sj,
                E.gw,
                CONVERT(nvarchar(100), E.orderNo) AS OrderNo,
                E.[ERR],
                D.ERRinformation
            FROM dbo.[Error] AS E
            LEFT JOIN dbo.ErrorDefine AS D ON D.ERR = E.[ERR]
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), tm))) = @tm
            ORDER BY
                CASE WHEN E.sj IS NULL THEN 1 ELSE 0 END,
                E.sj DESC,
                E.ID DESC;
            """;

        const string suggestionSql = """
            SELECT ItemContent
            FROM dbo.ErrReworkSuggestion
            WHERE ERR = @err
            ORDER BY SortOrder ASC, ID ASC;
            """;

        const string measureSql = """
            SELECT K.ItemContent
            FROM dbo.ErrKnowledgeMap AS M
            INNER JOIN dbo.ReworkKnowledgeItem AS K ON K.ID = M.KnowledgeID
            WHERE M.ERR = @err
              AND K.ItemType = 2
            ORDER BY M.SortOrder ASC, M.ID ASC;
            """;

        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);

            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            await using var command = new SqlCommand(sql, connection);
            command.Parameters.AddWithValue("@tm", normalizedTm);
            string? sj;
            int? gw;
            string? orderNo;
            int? err;
            string? errInformation;

            await using (var reader = await command.ExecuteReaderAsync(cancellationToken))
            {
                if (!await reader.ReadAsync(cancellationToken))
                {
                    return Ok(new ReworkLookupResponseDto(
                        normalizedTm,
                        false,
                        null,
                        null,
                        null,
                        null,
                        null,
                        [],
                        []));
                }

                sj = reader.IsDBNull(0)
                    ? null
                    : reader.GetDateTime(0).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                gw = reader.IsDBNull(1) ? null : reader.GetInt32(1);
                orderNo = reader.IsDBNull(2) ? null : reader.GetString(2);
                err = reader.IsDBNull(3) ? null : Convert.ToInt32(reader.GetValue(3), CultureInfo.InvariantCulture);
                errInformation = reader.IsDBNull(4) ? null : reader.GetString(4);
            }

            var reworkSuggestions = new List<string>();
            var repairMeasures = new List<string>();

            if (err.HasValue && err.Value > 0)
            {
                await using var suggestionCommand = new SqlCommand(suggestionSql, connection);
                suggestionCommand.Parameters.AddWithValue("@err", err.Value);
                await using (var suggestionReader = await suggestionCommand.ExecuteReaderAsync(cancellationToken))
                {
                    while (await suggestionReader.ReadAsync(cancellationToken))
                    {
                        var content = suggestionReader.IsDBNull(0) ? string.Empty : suggestionReader.GetString(0).Trim();
                        if (string.IsNullOrWhiteSpace(content)) continue;
                        reworkSuggestions.Add(content);
                    }
                }

                await using var measureCommand = new SqlCommand(measureSql, connection);
                measureCommand.Parameters.AddWithValue("@err", err.Value);
                await using (var measureReader = await measureCommand.ExecuteReaderAsync(cancellationToken))
                {
                    while (await measureReader.ReadAsync(cancellationToken))
                    {
                        var content = measureReader.IsDBNull(0) ? string.Empty : measureReader.GetString(0).Trim();
                        if (string.IsNullOrWhiteSpace(content)) continue;
                        repairMeasures.Add(content);
                    }
                }
            }

            return Ok(new ReworkLookupResponseDto(
                normalizedTm,
                true,
                sj,
                gw,
                string.IsNullOrWhiteSpace(orderNo) ? null : orderNo.Trim(),
                err,
                string.IsNullOrWhiteSpace(errInformation) ? null : errInformation.Trim(),
                reworkSuggestions,
                repairMeasures));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query latest rework record by tm");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "返修记录查询失败" });
        }
    }

    [HttpGet("rework-history")]
    public async Task<ActionResult<ReworkHistoryResponseDto>> GetReworkHistoryByTm(
        [FromQuery] string? tm,
        CancellationToken cancellationToken)
    {
        var normalizedTm = tm?.Trim();
        if (string.IsNullOrWhiteSpace(normalizedTm))
        {
            return BadRequest(new { message = "请输入返修字符串" });
        }

        const string errorSql = """
            SELECT TOP (500)
                E.sj,
                E.gw,
                CONVERT(nvarchar(100), E.orderNo) AS OrderNo,
                E.[ERR],
                ISNULL(D.ERRinformation, CONCAT('ERR ', CONVERT(varchar(16), E.[ERR]))) AS ErrInformation
            FROM dbo.[Error] AS E
            LEFT JOIN dbo.ErrorDefine AS D ON D.ERR = E.[ERR]
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), E.tm))) = @tm
            ORDER BY E.sj DESC, E.ID DESC;
            """;

        const string repairSql = """
            SELECT TOP (500)
                R.ConfirmedAt,
                R.RepairMeasure
            FROM dbo.RepairRecord AS R
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), R.tm))) = @tm
            ORDER BY R.ConfirmedAt DESC, R.ID DESC;
            """;

        var errorItems = new List<ReworkHistoryErrorItemDto>();
        var repairItems = new List<ReworkHistoryRepairItemDto>();

        try
        {
            await EnsureRepairRecordTableAsync(cancellationToken);
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);

            await using (var errorCommand = new SqlCommand(errorSql, connection))
            {
                errorCommand.Parameters.AddWithValue("@tm", normalizedTm);
                await using var errorReader = await errorCommand.ExecuteReaderAsync(cancellationToken);
                while (await errorReader.ReadAsync(cancellationToken))
                {
                    errorItems.Add(new ReworkHistoryErrorItemDto(
                        errorReader.IsDBNull(0) ? null : errorReader.GetDateTime(0).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                        errorReader.IsDBNull(1) ? null : errorReader.GetInt32(1),
                        errorReader.IsDBNull(2) ? null : errorReader.GetString(2),
                        errorReader.IsDBNull(3) ? null : Convert.ToInt32(errorReader.GetValue(3), CultureInfo.InvariantCulture),
                        errorReader.IsDBNull(4) ? null : errorReader.GetString(4)));
                }
            }

            await using (var repairCommand = new SqlCommand(repairSql, connection))
            {
                repairCommand.Parameters.AddWithValue("@tm", normalizedTm);
                await using var repairReader = await repairCommand.ExecuteReaderAsync(cancellationToken);
                while (await repairReader.ReadAsync(cancellationToken))
                {
                    repairItems.Add(new ReworkHistoryRepairItemDto(
                        repairReader.GetDateTime(0).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                        repairReader.IsDBNull(1) ? string.Empty : repairReader.GetString(1)));
                }
            }

            return Ok(new ReworkHistoryResponseDto(normalizedTm, errorItems, repairItems));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query rework history by tm");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "返修历史查询失败" });
        }
    }

    [HttpPost("repair-records/confirm")]
    public async Task<ActionResult<RepairRecordConfirmResponseDto>> ConfirmRepairRecord(
        [FromBody] RepairRecordConfirmRequestDto request,
        CancellationToken cancellationToken)
    {
        var tm = request.Tm?.Trim();
        var repairMeasure = request.RepairMeasure?.Trim();

        if (string.IsNullOrWhiteSpace(tm))
        {
            return BadRequest(new { message = "条码不能为空" });
        }

        if (string.IsNullOrWhiteSpace(repairMeasure))
        {
            return BadRequest(new { message = "请选择维修措施" });
        }

        if (!request.Err.HasValue || request.Err.Value <= 0)
        {
            return BadRequest(new { message = "ERR 无效" });
        }

        DateTime sj;
        if (string.IsNullOrWhiteSpace(request.Sj)
            || !DateTime.TryParse(request.Sj, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out sj))
        {
            return BadRequest(new { message = "时间格式无效" });
        }

        const string sql = """
            INSERT INTO dbo.RepairRecord
                (sj, tm, err, RepairMeasure, gw, orderNo, ConfirmedAt)
            OUTPUT INSERTED.ID, INSERTED.ConfirmedAt
            VALUES
                (@sj, @tm, @err, @repairMeasure, @gw, @orderNo, SYSDATETIME());
            """;

        try
        {
            await EnsureRepairRecordTableAsync(cancellationToken);

            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new SqlCommand(sql, connection);
            command.Parameters.AddWithValue("@sj", sj);
            command.Parameters.AddWithValue("@tm", tm);
            command.Parameters.AddWithValue("@err", request.Err.Value);
            command.Parameters.AddWithValue("@repairMeasure", repairMeasure);
            command.Parameters.AddWithValue("@gw", request.Gw.HasValue ? request.Gw.Value : DBNull.Value);
            command.Parameters.AddWithValue("@orderNo", string.IsNullOrWhiteSpace(request.OrderNo) ? DBNull.Value : request.OrderNo!.Trim());

            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            if (await reader.ReadAsync(cancellationToken))
            {
                var id = reader.GetInt64(0);
                var confirmedAt = reader.GetDateTime(1).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                return Ok(new RepairRecordConfirmResponseDto(id, confirmedAt));
            }

            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "维修确认写入失败" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to insert RepairRecord");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "维修确认写入失败" });
        }
    }

    [HttpGet("repair-records")]
    public async Task<ActionResult<RepairRecordListResponseDto>> GetRepairRecords(
        [FromQuery] DateTime? from,
        [FromQuery] DateTime? to,
        CancellationToken cancellationToken)
    {
        var toDate = (to ?? DateTime.Today).Date.AddDays(1).AddTicks(-1);
        var fromDate = (from ?? toDate.AddDays(-30)).Date;
        if (fromDate > toDate)
        {
            return BadRequest(new { message = "起始时间不能大于结束时间" });
        }

        const string sql = """
            SELECT TOP (5000)
                R.ID, R.sj, R.tm, R.err, ISNULL(D.ERRinformation, CONCAT('ERR ', CONVERT(varchar(16), R.err))) AS ErrInformation, R.RepairMeasure, R.gw, R.orderNo, R.ConfirmedAt
            FROM dbo.RepairRecord AS R
            LEFT JOIN dbo.ErrorDefine AS D ON D.ERR = R.err
            WHERE ConfirmedAt >= @from
              AND ConfirmedAt <= @to
            ORDER BY R.ConfirmedAt DESC, R.ID DESC;
            """;

        var items = new List<RepairRecordItemDto>();
        try
        {
            await EnsureRepairRecordTableAsync(cancellationToken);
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new SqlCommand(sql, connection);
            command.Parameters.AddWithValue("@from", fromDate);
            command.Parameters.AddWithValue("@to", toDate);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                items.Add(new RepairRecordItemDto(
                    reader.GetInt64(0),
                    reader.GetDateTime(1).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                    reader.GetString(2),
                    Convert.ToInt32(reader.GetValue(3), CultureInfo.InvariantCulture),
                    reader.IsDBNull(4) ? "-" : reader.GetString(4),
                    reader.GetString(5),
                    reader.IsDBNull(6) ? null : reader.GetInt32(6),
                    reader.IsDBNull(7) ? null : reader.GetString(7),
                    reader.GetDateTime(8).ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture)));
            }

            return Ok(new RepairRecordListResponseDto(
                fromDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                toDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                items));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query RepairRecord list");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "返修记录查询失败" });
        }
    }

    [HttpGet("repair-records/daily")]
    public async Task<ActionResult<RepairRecordDailyResponseDto>> GetRepairRecordDaily(
        [FromQuery] int months = 12,
        CancellationToken cancellationToken = default)
    {
        var safeMonths = Math.Clamp(months, 1, 24);
        var startDate = new DateTime(DateTime.Today.Year, DateTime.Today.Month, 1).AddMonths(-(safeMonths - 1));
        var endDate = DateTime.Today.AddDays(1).AddTicks(-1);

        const string sql = """
            SELECT CONVERT(char(10), CAST(ConfirmedAt AS date), 23) AS [DayKey], COUNT_BIG(1) AS Cnt
            FROM dbo.RepairRecord
            WHERE ConfirmedAt >= @from
              AND ConfirmedAt <= @to
            GROUP BY CAST(ConfirmedAt AS date)
            ORDER BY CAST(ConfirmedAt AS date) ASC;
            """;

        var daily = new List<ProductionByDateBucketDto>();
        try
        {
            await EnsureRepairRecordTableAsync(cancellationToken);
            await using var connection = new SqlConnection(_connectionString);
            await connection.OpenAsync(cancellationToken);
            await using var command = new SqlCommand(sql, connection);
            command.Parameters.AddWithValue("@from", startDate);
            command.Parameters.AddWithValue("@to", endDate);
            await using var reader = await command.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken))
            {
                daily.Add(new ProductionByDateBucketDto(reader.GetString(0), Convert.ToInt32(reader.GetInt64(1))));
            }

            return Ok(new RepairRecordDailyResponseDto(
                startDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                endDate.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                safeMonths,
                daily));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query RepairRecord daily stats");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "返修记录统计失败" });
        }
    }

    private async Task EnsureRepairRecordTableAsync(CancellationToken cancellationToken)
    {
        const string sql = """
            IF OBJECT_ID(N'dbo.RepairRecord', N'U') IS NULL
            BEGIN
                CREATE TABLE dbo.RepairRecord
                (
                    ID BIGINT IDENTITY(1,1) NOT NULL PRIMARY KEY,
                    sj DATETIME2(0) NOT NULL,
                    tm NVARCHAR(200) NOT NULL,
                    err INT NOT NULL,
                    RepairMeasure NVARCHAR(500) NOT NULL,
                    gw INT NULL,
                    orderNo NVARCHAR(100) NULL,
                    ConfirmedAt DATETIME2(0) NOT NULL CONSTRAINT DF_RepairRecord_ConfirmedAt DEFAULT(SYSDATETIME())
                );

                CREATE INDEX IX_RepairRecord_tm ON dbo.RepairRecord(tm);
                CREATE INDEX IX_RepairRecord_sj ON dbo.RepairRecord(sj DESC);
            END
            """;

        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);
        await using var command = new SqlCommand(sql, connection);
        await command.ExecuteNonQueryAsync(cancellationToken);
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
    IReadOnlyList<FaultErrorDefinitionDto> QuarterErrorDefinitions,
    IReadOnlyList<FaultQuarterBucketDto> QuarterErrorDetails,
    IReadOnlyList<ProductionByDateBucketDto> QuarterQualifiedDetails,
    string GeneratedAt);

public sealed record FaultErrorDefinitionDto(
    int Err,
    string Information);

public sealed record FaultQuarterBucketDto(
    string Date,
    int Err,
    int Count);

public sealed record ReworkLookupResponseDto(
    string Tm,
    bool Found,
    string? Sj,
    int? Gw,
    string? OrderNo,
    int? Err,
    string? ErrInformation,
    IReadOnlyList<string> ReworkSuggestions,
    IReadOnlyList<string> RepairMeasures);

public sealed record ReworkHistoryErrorItemDto(
    string? Sj,
    int? Gw,
    string? OrderNo,
    int? Err,
    string? ErrInformation);

public sealed record ReworkHistoryRepairItemDto(
    string ConfirmedAt,
    string RepairMeasure);

public sealed record ReworkHistoryResponseDto(
    string Tm,
    IReadOnlyList<ReworkHistoryErrorItemDto> ErrorItems,
    IReadOnlyList<ReworkHistoryRepairItemDto> RepairItems);

public sealed record RepairRecordConfirmRequestDto(
    string? Tm,
    string? Sj,
    int? Gw,
    string? OrderNo,
    int? Err,
    string? RepairMeasure);

public sealed record RepairRecordConfirmResponseDto(
    long Id,
    string ConfirmedAt);

public sealed record RepairRecordItemDto(
    long Id,
    string Sj,
    string Tm,
    int Err,
    string ErrInformation,
    string RepairMeasure,
    int? Gw,
    string? OrderNo,
    string ConfirmedAt);

public sealed record RepairRecordListResponseDto(
    string From,
    string To,
    IReadOnlyList<RepairRecordItemDto> Items);

public sealed record RepairRecordDailyResponseDto(
    string From,
    string To,
    int Months,
    IReadOnlyList<ProductionByDateBucketDto> Daily);

public sealed record FactoryTestReportResponseDto(
    string From,
    string To,
    int TotalCount,
    int ReturnedCount,
    bool IsTruncated,
    IReadOnlyList<string> Columns,
    IReadOnlyList<Dictionary<string, string?>> Rows,
    string GeneratedAt);
