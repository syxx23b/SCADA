using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Data.SqlClient;
using Scada.Api.Data;
using Scada.Api.Services;
using System.Globalization;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/production")]
public sealed class ProductionController : ControllerBase
{
    private const int FactoryTestReportMaxRows = 10000;
    private static readonly FactoryTestReportColumnDto[] FactoryTestReportColumns =
    [
        new("sj", "时间", "排产信息", "center"),
        new("ry", "人员", "排产信息", "left"),
        new("tm", "条码", "排产信息", "left"),
        new("gw", "工位", "排产信息", "right"),
        new("orderNo", "订单号", "排产信息", "left"),
        new("model", "型号", "排产信息", "left"),
        new("inletPressure", "进水压力", "测试环境", "right"),
        new("inletTemp", "水温", "测试环境", "right"),
        new("lowVoltage", "低压启动电压", "电机性能", "right"),
        new("lowCurrent", "低压启动电流", "电机性能", "right"),
        new("voltage", "常压电压", "电机性能", "right"),
        new("frequency", "频率", "电机性能", "right"),
        new("current", "电流", "电机性能", "right"),
        new("power", "功率", "电机性能", "right"),
        new("powerFactor", "功率因数", "电机性能", "right"),
        new("pressure", "工作压力", "泵头参数", "right"),
        new("holdingPressure", "保压压力", "泵头参数", "right"),
        new("recoilPressure", "反冲压力", "泵头参数", "right"),
        new("siphon", "虹吸", "泵头参数", "right"),
        new("flow", "流量", "泵头参数", "right"),
    ];

    private static readonly FactoryTestReportColumnDto[] FactoryTestReportEnglishColumns =
    [
        new("sj", "Time", "Production Info", "center"),
        new("ry", "Operator", "Production Info", "left"),
        new("tm", "Barcode", "Production Info", "left"),
        new("gw", "Station", "Production Info", "right"),
        new("orderNo", "Order No.", "Production Info", "left"),
        new("model", "Model", "Production Info", "left"),
        new("inletPressure", "Inlet Pressure", "Test Environment", "right"),
        new("inletTemp", "Water Temp.", "Test Environment", "right"),
        new("lowVoltage", "Low Start Voltage", "Motor Performance", "right"),
        new("lowCurrent", "Low Start Current", "Motor Performance", "right"),
        new("voltage", "Normal Voltage", "Motor Performance", "right"),
        new("frequency", "Frequency", "Motor Performance", "right"),
        new("current", "Current", "Motor Performance", "right"),
        new("power", "Power", "Motor Performance", "right"),
        new("powerFactor", "Power Factor", "Motor Performance", "right"),
        new("pressure", "Work Pressure", "Pump Parameters", "right"),
        new("holdingPressure", "Holding Pressure", "Pump Parameters", "right"),
        new("recoilPressure", "Recoil Pressure", "Pump Parameters", "right"),
        new("siphon", "Siphon", "Pump Parameters", "right"),
        new("flow", "Flow", "Pump Parameters", "right"),
    ];

    private static readonly FactoryTestReportColumnDto[] GasEngineFactoryReportColumns =
    [
        new("sj", "时间", "排产信息", "center"),
        new("ry", "人员", "排产信息", "left"),
        new("tm", "条码", "排产信息", "left"),
        new("gw", "工位", "排产信息", "right"),
        new("orderNo", "订单号", "排产信息", "left"),
        new("model", "型号", "排产信息", "left"),
        new("inletPressure", "进水压力", "测试环境", "right"),
        new("inletTemp", "水温", "测试环境", "right"),
        new("unloadSpeed", "空载转速", "电机性能", "right"),
        new("loadSpeed", "负载转速", "电机性能", "right"),
        new("pressure", "工作压力", "泵头参数", "right"),
        new("holdingPressure", "保压压力", "泵头参数", "right"),
        new("recoilPressure", "反冲压力", "泵头参数", "right"),
        new("siphon", "虹吸", "泵头参数", "right"),
        new("flow", "流量", "泵头参数", "right"),
    ];

    private static readonly FactoryTestReportColumnDto[] GasEngineFactoryReportEnglishColumns =
    [
        new("sj", "Time", "Production Info", "center"),
        new("ry", "Operator", "Production Info", "left"),
        new("tm", "Barcode", "Production Info", "left"),
        new("gw", "Station", "Production Info", "right"),
        new("orderNo", "Order No.", "Production Info", "left"),
        new("model", "Model", "Production Info", "left"),
        new("inletPressure", "Inlet Pressure", "Test Environment", "right"),
        new("inletTemp", "Water Temp.", "Test Environment", "right"),
        new("unloadSpeed", "Unload Speed", "Motor Performance", "right"),
        new("loadSpeed", "Load Speed", "Motor Performance", "right"),
        new("pressure", "Work Pressure", "Pump Parameters", "right"),
        new("holdingPressure", "Holding Pressure", "Pump Parameters", "right"),
        new("recoilPressure", "Recoil Pressure", "Pump Parameters", "right"),
        new("siphon", "Siphon", "Pump Parameters", "right"),
        new("flow", "Flow", "Pump Parameters", "right"),
    ];

    private static readonly HashSet<string> EnduranceHiddenColumnKeys = new(StringComparer.OrdinalIgnoreCase)
    {
        "lowVoltage",
        "lowCurrent",
    };

    private const string FactoryTestReportCountSql = """
        SELECT COUNT_BIG(1)
        FROM dbo.Record
        WHERE sj >= @from
          AND sj <= @to
          AND gw > 0
          AND mode = @mode
          AND (@orderNo IS NULL OR LTRIM(RTRIM(CONVERT(nvarchar(100), [orderNo]))) = @orderNo)
          AND (@gw IS NULL OR [gw] = @gw);
        """;

    private const string FactoryTestReportRowsSql = """
        SELECT TOP (@maxRows)
            sj,
            ry,
            tm,
            model,
            orderNo,
            gw,
            inletTemp,
            inletPressure,
            lowVoltage,
            lowCurrent,
            voltage,
            frequency,
            [current],
            power,
            powerFactor,
            pressure,
            holdingPressure,
            recoilPressure,
            flow,
            siphon
        FROM dbo.Record
        WHERE sj >= @from
          AND sj <= @to
          AND gw > 0
          AND mode = @mode
          AND (@orderNo IS NULL OR LTRIM(RTRIM(CONVERT(nvarchar(100), [orderNo]))) = @orderNo)
          AND (@gw IS NULL OR [gw] = @gw)
        ORDER BY sj DESC;
        """;

    private const string GasEngineFactoryReportRowsSql = """
        SELECT TOP (@maxRows)
            sj,
            ry,
            tm,
            model,
            orderNo,
            gw,
            inletTemp,
            inletPressure,
            unloadSpeed,
            loadSpeed,
            pressure,
            holdingPressure,
            recoilPressure,
            flow,
            siphon
        FROM dbo.Record
        WHERE sj >= @from
          AND sj <= @to
          AND gw > 0
          AND mode = @mode
          AND (@orderNo IS NULL OR LTRIM(RTRIM(CONVERT(nvarchar(100), [orderNo]))) = @orderNo)
          AND (@gw IS NULL OR [gw] = @gw)
        ORDER BY sj DESC;
        """;

    private readonly string _connectionString;
    private readonly ScadaDbContext _dbContext;
    private readonly ILogger<ProductionController> _logger;

    public ProductionController(IConfiguration configuration, ScadaDbContext dbContext, ILogger<ProductionController> logger)
    {
        _connectionString = configuration.GetConnectionString("MssqlRecordDb")
            ?? throw new InvalidOperationException("Missing connection string: MssqlRecordDb");
        _dbContext = dbContext;
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
        var annualCurrentYearDaily = new List<ProductionByDateBucketDto>();

        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);
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

            const string annualDailySql = """
                SELECT CONVERT(char(10), CAST(sj AS date), 23) AS [DayKey], COUNT_BIG(1) AS Cnt
                FROM dbo.Record
                WHERE mode = 0
                  AND gw > 0
                  AND sj >= DATEFROMPARTS(YEAR(GETDATE()), 1, 1)
                  AND sj < DATEADD(year, 1, DATEFROMPARTS(YEAR(GETDATE()), 1, 1))
                GROUP BY CAST(sj AS date)
                ORDER BY CAST(sj AS date) ASC;
                """;

            await using (var annualDailyCommand = new SqlCommand(annualDailySql, connection))
            {
                await using var reader = await annualDailyCommand.ExecuteReaderAsync(cancellationToken);
                while (await reader.ReadAsync(cancellationToken))
                {
                    var date = reader.GetString(0);
                    var count = Convert.ToInt32(reader.GetInt64(1));
                    annualCurrentYearDaily.Add(new ProductionByDateBucketDto(date, count));
                }
            }
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query production statistics from MSSQL");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "浜ч噺缁熻鏌ヨ澶辫触" });
        }

        var now = DateTimeOffset.Now;
        var response = new ProductionByGwResponseDto(
            now.Date.ToString("yyyy-MM-dd"),
            buckets.Sum(item => item.Count),
            buckets,
            dailyLast30Years,
            monthlyLast12Months,
            annualCurrentYearDaily,
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
            FROM ErrRepaire.ErrorDefine
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
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "鏁呴殰鍒嗘瀽鏌ヨ澶辫触" });
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
            return BadRequest(new { message = "璇疯緭鍏ヨ繑淇瓧绗︿覆" });
        }

        const string sql = """
            SELECT TOP (1)
                E.sj,
                E.gw,
                CONVERT(nvarchar(100), E.orderNo) AS OrderNo,
                E.[ERR],
                D.ERRinformation
            FROM dbo.[Error] AS E
            LEFT JOIN ErrRepaire.ErrorDefine AS D ON D.ERR = E.[ERR]
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), tm))) = @tm
            ORDER BY
                CASE WHEN E.sj IS NULL THEN 1 ELSE 0 END,
                E.sj DESC,
                E.ID DESC;
            """;

        const string suggestionSql = """
            SELECT ItemContent
            FROM ErrRepaire.ErrReworkSuggestion
            WHERE ERR = @err
            ORDER BY SortOrder ASC, ID ASC;
            """;

        const string measureSql = """
            SELECT K.ItemContent
            FROM ErrRepaire.ErrKnowledgeMap AS M
            INNER JOIN ErrRepaire.ReworkKnowledgeItem AS K ON K.ID = M.KnowledgeID
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
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "杩斾慨璁板綍鏌ヨ澶辫触" });
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
            return BadRequest(new { message = "璇疯緭鍏ヨ繑淇瓧绗︿覆" });
        }

        const string errorSql = """
            SELECT TOP (500)
                E.sj,
                E.gw,
                CONVERT(nvarchar(100), E.orderNo) AS OrderNo,
                E.[ERR],
                ISNULL(D.ERRinformation, CONCAT('ERR ', CONVERT(varchar(16), E.[ERR]))) AS ErrInformation
            FROM dbo.[Error] AS E
            LEFT JOIN ErrRepaire.ErrorDefine AS D ON D.ERR = E.[ERR]
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), E.tm))) = @tm
            ORDER BY E.sj DESC, E.ID DESC;
            """;

        const string repairSql = """
            SELECT TOP (500)
                R.ConfirmedAt,
                R.RepairMeasure
            FROM ErrRepaire.RepairRecord AS R
            WHERE LTRIM(RTRIM(CONVERT(nvarchar(200), R.tm))) = @tm
            ORDER BY R.ConfirmedAt DESC, R.ID DESC;
            """;

        var errorItems = new List<ReworkHistoryErrorItemDto>();
        var repairItems = new List<ReworkHistoryRepairItemDto>();

        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);
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
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "杩斾慨鍘嗗彶鏌ヨ澶辫触" });
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
            return BadRequest(new { message = "鏉＄爜涓嶈兘涓虹┖" });
        }

        if (string.IsNullOrWhiteSpace(repairMeasure))
        {
            return BadRequest(new { message = "璇烽€夋嫨缁翠慨鎺柦" });
        }

        if (!request.Err.HasValue || request.Err.Value <= 0)
        {
            return BadRequest(new { message = "ERR 鏃犳晥" });
        }

        DateTime sj;
        if (string.IsNullOrWhiteSpace(request.Sj)
            || !DateTime.TryParse(request.Sj, CultureInfo.InvariantCulture, DateTimeStyles.AssumeLocal, out sj))
        {
            return BadRequest(new { message = "鏃堕棿鏍煎紡鏃犳晥" });
        }

        const string sql = """
            INSERT INTO ErrRepaire.RepairRecord
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

            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "缁翠慨纭鍐欏叆澶辫触" });
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to insert RepairRecord");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "缁翠慨纭鍐欏叆澶辫触" });
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
            return BadRequest(new { message = "璧峰鏃堕棿涓嶈兘澶т簬缁撴潫鏃堕棿" });
        }

        const string sql = """
            SELECT TOP (5000)
                R.ID, R.sj, R.tm, R.err, ISNULL(D.ERRinformation, CONCAT('ERR ', CONVERT(varchar(16), R.err))) AS ErrInformation, R.RepairMeasure, R.gw, R.orderNo, R.ConfirmedAt
            FROM ErrRepaire.RepairRecord AS R
            LEFT JOIN ErrRepaire.ErrorDefine AS D ON D.ERR = R.err
            WHERE ConfirmedAt >= @from
              AND ConfirmedAt <= @to
            ORDER BY R.ConfirmedAt DESC, R.ID DESC;
            """;

        var items = new List<RepairRecordItemDto>();
        try
        {
            await ReworkConfigSchemaInitializer.EnsureInitializedAsync(_connectionString, cancellationToken);
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
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "杩斾慨璁板綍鏌ヨ澶辫触" });
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
            FROM ErrRepaire.RepairRecord
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
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "杩斾慨璁板綍缁熻澶辫触" });
        }
    }

    private async Task EnsureRepairRecordTableAsync(CancellationToken cancellationToken)
    {
        const string sql = """
            IF SCHEMA_ID(N'ErrRepaire') IS NULL
            BEGIN
                EXEC(N'CREATE SCHEMA [ErrRepaire]');
            END;

            IF OBJECT_ID(N'[dbo].[RepairRecord]', N'U') IS NOT NULL
               AND OBJECT_ID(N'[ErrRepaire].[RepairRecord]', N'U') IS NULL
            BEGIN
                EXEC(N'ALTER SCHEMA [ErrRepaire] TRANSFER [dbo].[RepairRecord]');
            END;

            IF OBJECT_ID(N'ErrRepaire.RepairRecord', N'U') IS NULL
            BEGIN
                CREATE TABLE ErrRepaire.RepairRecord
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

                CREATE INDEX IX_RepairRecord_tm ON ErrRepaire.RepairRecord(tm);
                CREATE INDEX IX_RepairRecord_sj ON ErrRepaire.RepairRecord(sj DESC);
            END;
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
            return BadRequest(new { message = "璧峰鏃堕棿涓嶈兘澶т簬缁撴潫鏃堕棿" });
        }

        try
        {
            return Ok(await QueryFactoryTestReportAsync(from, to, gw, orderNo, mode: 0, FactoryTestReportColumns, FactoryTestReportRowsSql, cancellationToken));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query factory test report from MSSQL");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "鍑哄巶娴嬭瘯鎶ヨ〃鏌ヨ澶辫触" });
        }
    }

    [HttpGet("factory-test-report/export/excel")]
    public async Task<IActionResult> ExportFactoryTestReportExcel(
        [FromQuery] DateTime from,
        [FromQuery] DateTime to,
        [FromQuery] int? gw,
        [FromQuery] string? orderNo,
        [FromQuery] string? lang,
        CancellationToken cancellationToken)
    {
        var displayColumns = GetFactoryTestReportDisplayColumns(lang);
        var title = IsFactoryTestReportEnglish(lang) ? "Pressure Washer Test Record" : "清洗机测试记录报表";
        return await ExportFactoryTestReportExcelAsync(
            from, to, gw, orderNo, mode: 0,
            FactoryTestReportColumns, FactoryTestReportRowsSql, displayColumns,
            title, "FactoryTestReport", "factory_test_report",
            "Failed to export factory test report from MSSQL", "出厂测试报表导出失败",
            cancellationToken);
    }

    [HttpGet("endurance-test-report")]
    public async Task<ActionResult<FactoryTestReportResponseDto>> GetEnduranceTestReport(
        [FromQuery] DateTime from,
        [FromQuery] DateTime to,
        [FromQuery] int? gw,
        [FromQuery] string? orderNo,
        CancellationToken cancellationToken)
    {
        if (from > to)
        {
            return BadRequest(new { message = "开始时间不能大于结束时间" });
        }

        try
        {
            return Ok(await QueryFactoryTestReportAsync(from, to, gw, orderNo, mode: 1, FactoryTestReportColumns, FactoryTestReportRowsSql, cancellationToken));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query endurance test report from MSSQL");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "耐久测试报表查询失败" });
        }
    }

    [HttpGet("endurance-test-report/export/excel")]
    public async Task<IActionResult> ExportEnduranceTestReportExcel(
        [FromQuery] DateTime from,
        [FromQuery] DateTime to,
        [FromQuery] int? gw,
        [FromQuery] string? orderNo,
        [FromQuery] string? lang,
        CancellationToken cancellationToken)
    {
        var displayColumns = GetFactoryTestReportDisplayColumns(lang, excludeLowStartColumns: true);
        var title = IsFactoryTestReportEnglish(lang) ? "Pressure Washer Endurance Test Record" : "清洗机耐久测试记录报表";
        return await ExportFactoryTestReportExcelAsync(
            from, to, gw, orderNo, mode: 1,
            FactoryTestReportColumns, FactoryTestReportRowsSql, displayColumns,
            title, "EnduranceTestReport", "endurance_test_report",
            "Failed to export endurance test report from MSSQL", "耐久测试报表导出失败",
            cancellationToken);
    }

    [HttpGet("gas-engine-factory-test-report")]
    public async Task<ActionResult<FactoryTestReportResponseDto>> GetGasEngineFactoryTestReport(
        [FromQuery] DateTime from,
        [FromQuery] DateTime to,
        [FromQuery] int? gw,
        [FromQuery] string? orderNo,
        CancellationToken cancellationToken)
    {
        if (from > to)
        {
            return BadRequest(new { message = "开始时间不能大于结束时间" });
        }

        try
        {
            return Ok(await QueryFactoryTestReportAsync(from, to, gw, orderNo, mode: 0, GasEngineFactoryReportColumns, GasEngineFactoryReportRowsSql, cancellationToken));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query gas engine factory test report from MSSQL");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "汽油机出厂测试报表查询失败" });
        }
    }

    [HttpGet("gas-engine-factory-test-report/export/excel")]
    public async Task<IActionResult> ExportGasEngineFactoryTestReportExcel(
        [FromQuery] DateTime from,
        [FromQuery] DateTime to,
        [FromQuery] int? gw,
        [FromQuery] string? orderNo,
        [FromQuery] string? lang,
        CancellationToken cancellationToken)
    {
        var displayColumns = GetGasEngineFactoryReportDisplayColumns(lang);
        var title = IsFactoryTestReportEnglish(lang) ? "Gas Engine Factory Test Record" : "汽油机出厂测试记录报表";
        return await ExportFactoryTestReportExcelAsync(
            from, to, gw, orderNo, mode: 0,
            GasEngineFactoryReportColumns, GasEngineFactoryReportRowsSql, displayColumns,
            title, "GasEngineFactoryReport", "gas_engine_factory_test_report",
            "Failed to export gas engine factory test report from MSSQL", "汽油机出厂测试报表导出失败",
            cancellationToken);
    }

    [HttpGet("gas-engine-endurance-test-report")]
    public async Task<ActionResult<FactoryTestReportResponseDto>> GetGasEngineEnduranceTestReport(
        [FromQuery] DateTime from,
        [FromQuery] DateTime to,
        [FromQuery] int? gw,
        [FromQuery] string? orderNo,
        CancellationToken cancellationToken)
    {
        if (from > to)
        {
            return BadRequest(new { message = "开始时间不能大于结束时间" });
        }

        try
        {
            return Ok(await QueryFactoryTestReportAsync(from, to, gw, orderNo, mode: 1, GasEngineFactoryReportColumns, GasEngineFactoryReportRowsSql, cancellationToken));
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, "Failed to query gas engine endurance test report from MSSQL");
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = "汽油机耐久测试报表查询失败" });
        }
    }

    [HttpGet("gas-engine-endurance-test-report/export/excel")]
    public async Task<IActionResult> ExportGasEngineEnduranceTestReportExcel(
        [FromQuery] DateTime from,
        [FromQuery] DateTime to,
        [FromQuery] int? gw,
        [FromQuery] string? orderNo,
        [FromQuery] string? lang,
        CancellationToken cancellationToken)
    {
        var displayColumns = GetGasEngineFactoryReportDisplayColumns(lang);
        var title = IsFactoryTestReportEnglish(lang) ? "Gas Engine Endurance Test Record" : "汽油机耐久测试记录报表";
        return await ExportFactoryTestReportExcelAsync(
            from, to, gw, orderNo, mode: 1,
            GasEngineFactoryReportColumns, GasEngineFactoryReportRowsSql, displayColumns,
            title, "GasEngineEnduranceReport", "gas_engine_endurance_test_report",
            "Failed to export gas engine endurance test report from MSSQL", "汽油机耐久测试报表导出失败",
            cancellationToken);
    }

    private static FactoryTestReportColumnDto[] GetFactoryTestReportDisplayColumns(string? lang, bool excludeLowStartColumns = false)
    {
        var columns = IsFactoryTestReportEnglish(lang) ? FactoryTestReportEnglishColumns : FactoryTestReportColumns;
        return excludeLowStartColumns
            ? columns.Where(column => !EnduranceHiddenColumnKeys.Contains(column.Key)).ToArray()
            : columns;
    }

    private async Task<IActionResult> ExportFactoryTestReportExcelAsync(
        DateTime from,
        DateTime to,
        int? gw,
        string? orderNo,
        int mode,
        IReadOnlyList<FactoryTestReportColumnDto> queryColumns,
        string rowsSql,
        IReadOnlyList<FactoryTestReportColumnDto> displayColumns,
        string title,
        string sheetName,
        string filePrefix,
        string logMessage,
        string errorMessage,
        CancellationToken cancellationToken)
    {
        if (from > to)
        {
            return BadRequest(new { message = "开始时间不能大于结束时间" });
        }

        FactoryTestReportResponseDto report;
        try
        {
            report = await QueryFactoryTestReportAsync(from, to, gw, orderNo, mode, queryColumns, rowsSql, cancellationToken);
        }
        catch (Exception ex)
        {
            _logger.LogError(ex, logMessage);
            return StatusCode(StatusCodes.Status500InternalServerError, new { message = errorMessage });
        }

        var units = await GetFactoryTestReportUnitsAsync(cancellationToken);
        using var workbook = new XLWorkbook();
        var worksheet = workbook.Worksheets.Add(sheetName);

        worksheet.Cell(1, 1).Value = title;
        worksheet.Range(1, 1, 1, displayColumns.Count).Merge();
        worksheet.Cell(1, 1).Style.Font.FontName = "HarmonyOS Sans SC";
        worksheet.Cell(1, 1).Style.Font.Bold = true;
        worksheet.Cell(1, 1).Style.Font.FontSize = 18;
        worksheet.Cell(1, 1).Style.Font.FontColor = XLColor.FromHtml("#005f87");
        worksheet.Cell(1, 1).Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

        var groupSpans = displayColumns
            .GroupBy(column => column.Group)
            .Select(group => new { Label = group.Key, Count = group.Count() });
        var startColumn = 1;
        foreach (var group in groupSpans)
        {
            var endColumn = startColumn + group.Count - 1;
            worksheet.Cell(2, startColumn).Value = group.Label;
            worksheet.Range(2, startColumn, 2, endColumn).Merge();
            startColumn = endColumn + 1;
        }

        for (var index = 0; index < displayColumns.Count; index++)
        {
            worksheet.Cell(3, index + 1).Value = displayColumns[index].Label;
        }

        for (var rowIndex = 0; rowIndex < report.Rows.Count; rowIndex++)
        {
            var row = report.Rows[rowIndex];
            for (var columnIndex = 0; columnIndex < displayColumns.Count; columnIndex++)
            {
                var key = displayColumns[columnIndex].Key;
                worksheet.Cell(rowIndex + 4, columnIndex + 1).Value = FormatFactoryTestReportExcelValue(
                    key,
                    row.TryGetValue(key, out var value) ? value : null,
                    units.PressureUnit,
                    units.FlowUnit);
            }
        }

        var usedRange = worksheet.Range(1, 1, Math.Max(3, report.Rows.Count + 3), displayColumns.Count);
        usedRange.Style.Font.FontName = "HarmonyOS Sans SC";
        usedRange.Style.Border.OutsideBorder = XLBorderStyleValues.None;
        usedRange.Style.Border.InsideBorder = XLBorderStyleValues.None;
        usedRange.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

        var groupHeaderRange = worksheet.Range(2, 1, 2, displayColumns.Count);
        groupHeaderRange.Style.Fill.BackgroundColor = XLColor.FromHtml("#3679df");
        groupHeaderRange.Style.Font.FontColor = XLColor.White;
        groupHeaderRange.Style.Font.Bold = true;
        groupHeaderRange.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;

        var columnHeaderRange = worksheet.Range(3, 1, 3, displayColumns.Count);
        columnHeaderRange.Style.Fill.BackgroundColor = XLColor.FromHtml("#4285f4");
        columnHeaderRange.Style.Font.FontColor = XLColor.White;
        columnHeaderRange.Style.Font.Bold = true;
        columnHeaderRange.Style.Alignment.Horizontal = XLAlignmentHorizontalValues.Center;
        worksheet.SheetView.FreezeRows(3);
        ApplyFactoryTestReportExcelLayout(worksheet, displayColumns);

        using var stream = new MemoryStream();
        workbook.SaveAs(stream);
        return File(
            stream.ToArray(),
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            $"{filePrefix}_{DateTimeOffset.Now:yyyyMMdd_HHmmss}.xlsx");
    }

    private static FactoryTestReportColumnDto[] GetGasEngineFactoryReportDisplayColumns(string? lang)
    {
        return IsFactoryTestReportEnglish(lang) ? GasEngineFactoryReportEnglishColumns : GasEngineFactoryReportColumns;
    }

    private static bool IsFactoryTestReportEnglish(string? lang)
    {
        return string.Equals(lang?.Trim(), "en", StringComparison.OrdinalIgnoreCase);
    }

    private async Task<FactoryTestReportUnits> GetFactoryTestReportUnitsAsync(CancellationToken cancellationToken)
    {
        try
        {
            var settings = await _dbContext.SystemSettings
                .Where(item => item.Key == "PressureUnit" || item.Key == "FlowUnit")
                .ToDictionaryAsync(item => item.Key, item => item.Value, StringComparer.OrdinalIgnoreCase, cancellationToken);

            return new FactoryTestReportUnits(
                NormalizeFactoryTestReportUnit(settings.GetValueOrDefault("PressureUnit"), ["MPa", "PSI", "bar"], "MPa"),
                NormalizeFactoryTestReportUnit(settings.GetValueOrDefault("FlowUnit"), ["L/M", "m椴?h", "m鲁/h", "GPM"], "L/M"));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to read system units for factory test report export; using defaults");
            return new FactoryTestReportUnits("MPa", "L/M");
        }
    }

    private static string NormalizeFactoryTestReportUnit(string? value, string[] allowedUnits, string fallback)
    {
        var normalized = value?.Trim();
        if (string.IsNullOrWhiteSpace(normalized))
        {
            return fallback;
        }

        return allowedUnits.FirstOrDefault(item => item.Equals(normalized, StringComparison.OrdinalIgnoreCase)) ?? fallback;
    }

    private static string FormatFactoryTestReportExcelValue(string columnKey, string? value, string pressureUnit, string flowUnit)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            return string.Empty;
        }

        var numeric = decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var parsed)
            ? parsed
            : (decimal?)null;
        var trimmed = value.Trim();
        var oneDecimal = numeric.HasValue ? numeric.Value.ToString("0.0", CultureInfo.InvariantCulture) : trimmed;
        var wholeNumber = numeric.HasValue ? numeric.Value.ToString("0", CultureInfo.InvariantCulture) : trimmed;

        return columnKey switch
        {
            "inletPressure" => $"{trimmed} bar",
            "inletTemp" => $"{oneDecimal} ℃",
            "lowVoltage" or "voltage" => $"{oneDecimal} V",
            "lowCurrent" or "current" => $"{trimmed} A",
            "frequency" => $"{wholeNumber} Hz",
            "power" => $"{wholeNumber} W",
            "unloadSpeed" or "loadSpeed" => $"{wholeNumber} RPM",
            "pressure" or "holdingPressure" or "recoilPressure" => $"{trimmed} {pressureUnit}",
            "flow" => $"{trimmed} {flowUnit}",
            "siphon" => $"{oneDecimal} KPa",
            _ => trimmed
        };
    }

    private static void ApplyFactoryTestReportExcelLayout(IXLWorksheet worksheet, IReadOnlyList<FactoryTestReportColumnDto> columns)
    {
        var widths = new Dictionary<string, double>(StringComparer.OrdinalIgnoreCase)
        {
            ["sj"] = 20,
            ["ry"] = 12,
            ["tm"] = 22,
            ["model"] = 18,
            ["orderNo"] = 20,
            ["gw"] = 8,
            ["inletTemp"] = 12,
            ["inletPressure"] = 14,
            ["lowVoltage"] = 14,
            ["lowCurrent"] = 14,
            ["unloadSpeed"] = 14,
            ["loadSpeed"] = 14,
            ["voltage"] = 12,
            ["frequency"] = 12,
            ["current"] = 12,
            ["power"] = 12,
            ["powerFactor"] = 12,
            ["pressure"] = 14,
            ["holdingPressure"] = 16,
            ["recoilPressure"] = 16,
            ["flow"] = 14,
            ["siphon"] = 12,
        };

        for (var index = 0; index < columns.Count; index++)
        {
            var column = columns[index];
            worksheet.Column(index + 1).Width = widths.GetValueOrDefault(column.Key, 14);
        }

        worksheet.Rows(1, 3).Style.Alignment.Vertical = XLAlignmentVerticalValues.Center;
        worksheet.Rows(2, 3).Height = 24;
        worksheet.Rows(2, 3).Style.Alignment.WrapText = true;
        worksheet.Row(1).Height = 28;
    }

    private async Task<FactoryTestReportResponseDto> QueryFactoryTestReportAsync(
        DateTime from,
        DateTime to,
        int? gw,
        string? orderNo,
        int mode,
        IReadOnlyList<FactoryTestReportColumnDto> columns,
        string rowsSql,
        CancellationToken cancellationToken)
    {
        var rows = new List<Dictionary<string, string?>>();
        var chartPoints = new List<FactoryTestReportChartPointDto>();
        int totalCount;
        var normalizedOrderNo = string.IsNullOrWhiteSpace(orderNo) ? null : orderNo.Trim();

        await using var connection = new SqlConnection(_connectionString);
        await connection.OpenAsync(cancellationToken);

        await using (var countCommand = new SqlCommand(FactoryTestReportCountSql, connection))
        {
            countCommand.Parameters.AddWithValue("@from", from);
            countCommand.Parameters.AddWithValue("@to", to);
            countCommand.Parameters.AddWithValue("@gw", gw.HasValue ? gw.Value : DBNull.Value);
            countCommand.Parameters.AddWithValue("@orderNo", normalizedOrderNo is null ? DBNull.Value : normalizedOrderNo);
            countCommand.Parameters.AddWithValue("@mode", mode);
            totalCount = Convert.ToInt32(await countCommand.ExecuteScalarAsync(cancellationToken) ?? 0L);
        }

        await using var rowsCommand = new SqlCommand(rowsSql, connection);
        rowsCommand.Parameters.AddWithValue("@from", from);
        rowsCommand.Parameters.AddWithValue("@to", to);
        rowsCommand.Parameters.AddWithValue("@gw", gw.HasValue ? gw.Value : DBNull.Value);
        rowsCommand.Parameters.AddWithValue("@orderNo", normalizedOrderNo is null ? DBNull.Value : normalizedOrderNo);
        rowsCommand.Parameters.AddWithValue("@maxRows", FactoryTestReportMaxRows);
        rowsCommand.Parameters.AddWithValue("@mode", mode);

        await using var reader = await rowsCommand.ExecuteReaderAsync(cancellationToken);
        while (await reader.ReadAsync(cancellationToken))
        {
            var row = new Dictionary<string, string?>(columns.Count, StringComparer.OrdinalIgnoreCase);
            foreach (var column in columns)
            {
                var ordinal = reader.GetOrdinal(column.Key);
                if (reader.IsDBNull(ordinal))
                {
                    row[column.Key] = null;
                    continue;
                }

                var value = reader.GetValue(ordinal);
                row[column.Key] = value switch
                {
                    DateTime dateTime => dateTime.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                    DateTimeOffset dateTimeOffset => dateTimeOffset.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
                    _ => Convert.ToString(value, CultureInfo.InvariantCulture)
                };
            }

            rows.Add(row);
            chartPoints.Add(new FactoryTestReportChartPointDto(
                row.TryGetValue("sj", out var sj) ? sj : null,
                TryParseNullableDecimal(row.TryGetValue("pressure", out var pressure) ? pressure : null),
                TryParseNullableDecimal(row.TryGetValue("flow", out var flow) ? flow : null)));
        }

        return new FactoryTestReportResponseDto(
            from.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
            to.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture),
            totalCount,
            rows.Count,
            totalCount > rows.Count,
            mode == 1 && columns.SequenceEqual(FactoryTestReportColumns) ? FactoryTestReportColumns.Where(column => !EnduranceHiddenColumnKeys.Contains(column.Key)).ToArray() : columns,
            rows,
            chartPoints,
            DateTimeOffset.Now.ToString("O", CultureInfo.InvariantCulture));
    }

    private static decimal? TryParseNullableDecimal(string? value)
    {
        return decimal.TryParse(value, NumberStyles.Any, CultureInfo.InvariantCulture, out var result) ? result : null;
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
    IReadOnlyList<ProductionByDateBucketDto> AnnualCurrentYearDaily,
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
    IReadOnlyList<FactoryTestReportColumnDto> Columns,
    IReadOnlyList<Dictionary<string, string?>> Rows,
    IReadOnlyList<FactoryTestReportChartPointDto> ChartPoints,
    string GeneratedAt);

public sealed record FactoryTestReportColumnDto(
    string Key,
    string Label,
    string Group,
    string Align);

public sealed record FactoryTestReportChartPointDto(
    string? Sj,
    decimal? Pressure,
    decimal? Flow);

public sealed record FactoryTestReportUnits(
    string PressureUnit,
    string FlowUnit);
