using System.Diagnostics;
using System.Net.Sockets;

namespace Scada.Api.Services;

public sealed class ReportHostHostedService(ILogger<ReportHostHostedService> logger) : IHostedService
{
    private const string FineReportRoot = @"C:\finereport-win64";
    private const string FineReportBinRoot = @"C:\finereport-win64\bin";
    private const string StartupScript = @"C:\finereport-win64\bin\startup.bat";
    private const string ShutdownScript = @"C:\finereport-win64\bin\shutdown.bat";
    private const int ReportPort = 8080;

    public Task StartAsync(CancellationToken cancellationToken)
    {
        _ = Task.Run(() => RunStartupAsync(cancellationToken), CancellationToken.None);
        return Task.CompletedTask;
    }

    public async Task StopAsync(CancellationToken cancellationToken)
    {
        if (!await IsPortOpenAsync(ReportPort, cancellationToken))
        {
            return;
        }

        try
        {
            ValidateRequiredPaths();
            await RunScriptAsync(ShutdownScript, cancellationToken);

            if (!await WaitForPortStateAsync(ReportPort, shouldBeOpen: false, TimeSpan.FromSeconds(30), cancellationToken))
            {
                logger.LogWarning("FineReport shutdown script completed, but port {Port} is still open.", ReportPort);
            }
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "Failed while stopping FineReport through shutdown.bat.");
        }
    }

    private async Task RunStartupAsync(CancellationToken cancellationToken)
    {
        try
        {
            if (await IsPortOpenAsync(ReportPort, cancellationToken))
            {
                logger.LogInformation("FineReport is already available on port {Port}.", ReportPort);
                return;
            }

            ValidateRequiredPaths();

            logger.LogInformation("Starting FineReport silently via startup.bat on port {Port}.", ReportPort);
            await RunScriptAsync(StartupScript, cancellationToken);

            if (!await WaitForPortStateAsync(ReportPort, shouldBeOpen: true, TimeSpan.FromSeconds(60), cancellationToken))
            {
                throw new InvalidOperationException($"FineReport did not become ready on port {ReportPort} after startup.bat completed.");
            }

            logger.LogInformation("FineReport is ready on port {Port}.", ReportPort);
        }
        catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
        {
        }
        catch (Exception ex)
        {
            logger.LogWarning(ex, "FineReport startup failed. SCADA API will continue without the report host.");
        }
    }

    private static void ValidateRequiredPaths()
    {
        if (!Directory.Exists(FineReportRoot))
        {
            throw new DirectoryNotFoundException($"FineReport directory not found: {FineReportRoot}");
        }

        if (!Directory.Exists(FineReportBinRoot))
        {
            throw new DirectoryNotFoundException($"FineReport bin directory not found: {FineReportBinRoot}");
        }

        if (!File.Exists(StartupScript))
        {
            throw new FileNotFoundException($"FineReport startup script not found: {StartupScript}");
        }

        if (!File.Exists(ShutdownScript))
        {
            throw new FileNotFoundException($"FineReport shutdown script not found: {ShutdownScript}");
        }
    }

    private async Task RunScriptAsync(string scriptPath, CancellationToken cancellationToken)
    {
        var startInfo = new ProcessStartInfo
        {
            FileName = "cmd.exe",
            Arguments = $"/c \"\"{scriptPath}\"\"",
            WorkingDirectory = FineReportBinRoot,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };

        using var process = new Process
        {
            StartInfo = startInfo,
            EnableRaisingEvents = true
        };

        process.OutputDataReceived += (_, args) =>
        {
            if (!string.IsNullOrWhiteSpace(args.Data))
            {
                logger.LogInformation("FineReport script: {Line}", args.Data);
            }
        };
        process.ErrorDataReceived += (_, args) =>
        {
            if (!string.IsNullOrWhiteSpace(args.Data))
            {
                logger.LogWarning("FineReport script: {Line}", args.Data);
            }
        };

        if (!process.Start())
        {
            throw new InvalidOperationException($"Failed to start script: {scriptPath}");
        }

        process.BeginOutputReadLine();
        process.BeginErrorReadLine();
        await process.WaitForExitAsync(cancellationToken);

        if (process.ExitCode != 0)
        {
            throw new InvalidOperationException($"{Path.GetFileName(scriptPath)} failed with exit code {process.ExitCode}.");
        }
    }

    private static async Task<bool> WaitForPortStateAsync(int port, bool shouldBeOpen, TimeSpan timeout, CancellationToken cancellationToken)
    {
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline)
        {
            var isOpen = await IsPortOpenAsync(port, cancellationToken);
            if (isOpen == shouldBeOpen)
            {
                return true;
            }

            await Task.Delay(1000, cancellationToken);
        }

        return false;
    }

    private static async Task<bool> IsPortOpenAsync(int port, CancellationToken cancellationToken)
    {
        try
        {
            using var client = new TcpClient();
            using var registration = cancellationToken.Register(() => client.Dispose());
            await client.ConnectAsync("127.0.0.1", port, cancellationToken);
            return true;
        }
        catch
        {
            return false;
        }
    }
}
