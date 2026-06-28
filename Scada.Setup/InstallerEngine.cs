using System.Diagnostics;
using System.IO.Compression;
using System.Management;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Security.Principal;
using System.Text;
using System.ComponentModel;
using System.ServiceProcess;

namespace Scada.Setup;

internal static class InstallerEngine
{
    private const string LauncherName = "\u6E05\u6D17\u673A\u6D4B\u8BD5\u7BA1\u7406\u5E73\u53F0";
    private const string FineReportRoot = @"C:\finereport-win64";
    private const string ReportWebRoot = @"C:\finereport-win64";
    private static readonly TimeSpan ServiceWaitTimeout = TimeSpan.FromSeconds(8);
    private const int ServicePollDelayMilliseconds = 250;
    private const int ProcessExitWaitMilliseconds = 1500;
    private const int DirectoryDeleteRetryCount = 3;
    private const int DirectoryDeleteRetryDelayMilliseconds = 400;
    private static readonly string[] CandidateProcessNames = ["Scada.Api", "Scada.Launcher", "java", "javaw"];
    private static readonly Encoding SystemCommandEncoding = Encoding.GetEncoding((int)GetOEMCP());

    public static void Install(InstallerOptions options, Action<string> log)
    {
        EnsureWindows();
        EnsureAdministrator();

        var payloadRoot = ResolvePayloadRoot(log);
        var installDir = Path.GetFullPath(options.InstallDirectory);

        StopAndDeleteService(options, log);
        TerminateInstalledProcesses(installDir, log);
        DeleteDirectoryWithRetry(installDir, log);
        Directory.CreateDirectory(installDir);

        log($"Copying files to: {installDir}");
        CopyDirectory(payloadRoot, installDir);

        var serviceExe = Path.Combine(installDir, "Scada.Api.exe");
        var binPath = $"\"{serviceExe}\" --urls http://0.0.0.0:{options.Port}";

        log($"Registering service: {options.ServiceName}");
        RunProcess(
            "sc.exe",
            $"create {options.ServiceName} binPath= \"{binPath}\" start= auto DisplayName= \"{options.ServiceDisplayName}\" obj= LocalSystem",
            ignoreErrors: false,
            log);
        RunProcess("sc.exe", $"description {options.ServiceName} \"smScada service\"", ignoreErrors: false, log);
        RunProcess("sc.exe", $"failure {options.ServiceName} reset= 86400 actions= restart/5000/restart/5000/restart/5000", ignoreErrors: true, log);

        ConfigureFirewall(options, log);

        RunProcess("sc.exe", $"start {options.ServiceName}", ignoreErrors: false, log);
        CreateDesktopLauncher(options, log);

        log("Installation completed.");
        log($"Service name: {options.ServiceName}");
        log($"Access URL: http://127.0.0.1:{options.Port}");
    }

    public static void Uninstall(InstallerOptions options, Action<string> log)
    {
        EnsureWindows();
        EnsureAdministrator();

        StopAndDeleteService(options, log);
        TerminateInstalledProcesses(Path.GetFullPath(options.InstallDirectory), log);
        RunProcess("netsh", $"advfirewall firewall delete rule name=\"{options.ServiceDisplayName} TCP {options.Port}\"", ignoreErrors: true, log);
        DeleteDesktopLauncher(log);

        if (Directory.Exists(options.InstallDirectory))
        {
            DeleteDirectoryWithRetry(options.InstallDirectory, log);
        }

        log("Uninstall completed.");
    }

    public static void EnsureReady()
    {
        EnsureWindows();
        EnsureAdministrator();
    }

    private static string ResolvePayloadRoot(Action<string> log)
    {
        var externalPayloadRoot = Path.Combine(AppContext.BaseDirectory, "payload");
        if (Directory.Exists(externalPayloadRoot))
        {
            return externalPayloadRoot;
        }

        var extractedPayloadRoot = Path.Combine(Path.GetTempPath(), "Scada.Setup", $"payload-{Environment.ProcessId}");
        if (Directory.Exists(extractedPayloadRoot))
        {
            Directory.Delete(extractedPayloadRoot, recursive: true);
        }

        Directory.CreateDirectory(extractedPayloadRoot);

        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("payload.zip")
            ?? throw new DirectoryNotFoundException($"Installer payload not found: {externalPayloadRoot}");
        ZipFile.ExtractToDirectory(stream, extractedPayloadRoot, overwriteFiles: true);

        log($"Extracted installer payload to: {extractedPayloadRoot}");
        return extractedPayloadRoot;
    }

    private static void StopAndDeleteService(InstallerOptions options, Action<string> log)
    {
        if (!ServiceExists(options.ServiceName))
        {
            log("Service was not installed. Cleanup step skipped.");
            return;
        }

        RunProcess("sc.exe", $"stop {options.ServiceName}", ignoreErrors: true, log, suppressMissingServiceMessage: true);
        WaitForServiceToStop(options.ServiceName, log);
        RunProcess("sc.exe", $"delete {options.ServiceName}", ignoreErrors: true, log, suppressMissingServiceMessage: true);
        WaitForServiceToBeDeleted(options.ServiceName, log);
    }

    private static void WaitForServiceToStop(string serviceName, Action<string> log)
    {
        try
        {
            using var controller = new ServiceController(serviceName);
            _ = controller.Status;

            log($"Waiting for service to stop: {serviceName}");
            controller.WaitForStatus(ServiceControllerStatus.Stopped, ServiceWaitTimeout);
            controller.Refresh();
            log($"Service stopped: {serviceName}");
        }
        catch (InvalidOperationException)
        {
            log("Service was not installed. Cleanup step skipped.");
        }
    }

    private static void WaitForServiceToBeDeleted(string serviceName, Action<string> log)
    {
        log($"Waiting for service to be removed: {serviceName}");

        var timeoutAt = DateTime.UtcNow.Add(ServiceWaitTimeout);
        while (DateTime.UtcNow < timeoutAt)
        {
            if (!ServiceExists(serviceName))
            {
                log($"Service removed: {serviceName}");
                return;
            }

            Thread.Sleep(ServicePollDelayMilliseconds);
        }

        throw new InvalidOperationException($"Timed out while waiting for service deletion: {serviceName}");
    }

    private static bool ServiceExists(string serviceName)
    {
        try
        {
            using var controller = new ServiceController(serviceName);
            _ = controller.Status;
            return true;
        }
        catch (InvalidOperationException)
        {
            return false;
        }
    }

    private static void TerminateInstalledProcesses(string installDirectory, Action<string> log)
    {
        var expectedExecutables = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            Path.GetFullPath(Path.Combine(installDirectory, "Scada.Api.exe")),
            Path.GetFullPath(Path.Combine(installDirectory, "Scada.Launcher.exe"))
        };

        var installRoot = Path.GetFullPath(installDirectory)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        var reportHostRuntimeRoot = Path.Combine(installDirectory, "report-host");
        var fineReportRoot = Path.GetFullPath(FineReportRoot)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        var reportWebRoot = Path.GetFullPath(ReportWebRoot)
            .TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar)
            + Path.DirectorySeparatorChar;
        var candidateProcesses = CandidateProcessNames
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .SelectMany(GetProcessesByNameSafe)
            .GroupBy(process => process.Id)
            .Select(group => group.First())
            .ToArray();

        foreach (var process in candidateProcesses)
        {
            string? normalizedPath = null;

            try
            {
                var fileName = process.MainModule?.FileName;
                if (string.IsNullOrWhiteSpace(fileName))
                {
                    continue;
                }

                normalizedPath = Path.GetFullPath(fileName);
                if (!expectedExecutables.Contains(normalizedPath) &&
                    !ShouldTerminateAssociatedProcess(process, normalizedPath, installRoot, reportHostRuntimeRoot, fineReportRoot, reportWebRoot))
                {
                    continue;
                }

                log($"Stopping running process: {normalizedPath} (PID {process.Id})");
                process.Kill(entireProcessTree: true);
                process.WaitForExit(ProcessExitWaitMilliseconds);
            }
            catch (Win32Exception)
            {
            }
            catch (InvalidOperationException)
            {
            }
            catch (UnauthorizedAccessException)
            {
            }
            catch
            {
                if (normalizedPath is not null &&
                    (normalizedPath.StartsWith(installRoot, StringComparison.OrdinalIgnoreCase) ||
                     normalizedPath.StartsWith(fineReportRoot, StringComparison.OrdinalIgnoreCase) ||
                     normalizedPath.StartsWith(reportWebRoot, StringComparison.OrdinalIgnoreCase)))
                {
                    log($"Skipped a running process while cleaning up: {normalizedPath}");
                }
            }
            finally
            {
                process.Dispose();
            }
        }
    }

    private static IEnumerable<Process> GetProcessesByNameSafe(string processName)
    {
        try
        {
            return Process.GetProcessesByName(processName);
        }
        catch
        {
            return [];
        }
    }

    private static bool ShouldTerminateAssociatedProcess(
        Process process,
        string normalizedPath,
        string installRoot,
        string reportHostRuntimeRoot,
        string fineReportRoot,
        string reportWebRoot)
    {
        if (normalizedPath.StartsWith(installRoot, StringComparison.OrdinalIgnoreCase))
        {
            return true;
        }

        var commandLine = TryGetCommandLine(process);
        if (string.IsNullOrWhiteSpace(commandLine))
        {
            return false;
        }

        if (normalizedPath.EndsWith("java.exe", StringComparison.OrdinalIgnoreCase) ||
            normalizedPath.EndsWith("javaw.exe", StringComparison.OrdinalIgnoreCase))
        {
            return commandLine.Contains(reportHostRuntimeRoot, StringComparison.OrdinalIgnoreCase) ||
                   commandLine.Contains(FineReportRoot, StringComparison.OrdinalIgnoreCase) ||
                   commandLine.Contains(ReportWebRoot, StringComparison.OrdinalIgnoreCase) ||
                   commandLine.Contains("org.apache.catalina.startup.Bootstrap", StringComparison.OrdinalIgnoreCase);
        }

        return commandLine.Contains(reportHostRuntimeRoot, StringComparison.OrdinalIgnoreCase) ||
               commandLine.Contains(fineReportRoot, StringComparison.OrdinalIgnoreCase) ||
               commandLine.Contains(reportWebRoot, StringComparison.OrdinalIgnoreCase);
    }

    private static string? TryGetCommandLine(Process process)
    {
        try
        {
            using var searcher = new ManagementObjectSearcher(
                $"SELECT CommandLine FROM Win32_Process WHERE ProcessId = {process.Id}");
            foreach (var item in searcher.Get())
            {
                return item["CommandLine"]?.ToString();
            }
        }
        catch
        {
        }

        return null;
    }

    private static void ConfigureFirewall(InstallerOptions options, Action<string> log)
    {
        var ruleName = $"{options.ServiceDisplayName} TCP {options.Port}";
        RunProcess("netsh", $"advfirewall firewall delete rule name=\"{ruleName}\"", ignoreErrors: true, log);
        RunProcess("netsh", $"advfirewall firewall add rule name=\"{ruleName}\" dir=in action=allow protocol=TCP localport={options.Port}", ignoreErrors: false, log);
    }

    private static void CreateDesktopLauncher(InstallerOptions options, Action<string> log)
    {
        var desktopDirectory = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
        Directory.CreateDirectory(desktopDirectory);

        var launcherPath = Path.Combine(desktopDirectory, $"{LauncherName}.lnk");
        var iconPath = CopyLauncherIcon(options.InstallDirectory);

        DeleteLegacyUrlLauncher(desktopDirectory);
        CreateShellLink(launcherPath, iconPath, options.InstallDirectory);
        log($"Created desktop shortcut: {launcherPath}");
    }

    private static void CreateShellLink(string launcherPath, string iconPath, string workingDirectory)
    {
        var launcherExePath = Path.Combine(workingDirectory, "Scada.Launcher.exe");
        if (!File.Exists(launcherExePath))
        {
            throw new FileNotFoundException("Desktop launcher file Scada.Launcher.exe was not found.", launcherExePath);
        }

        var shellType = Type.GetTypeFromProgID("WScript.Shell", throwOnError: true)
            ?? throw new InvalidOperationException("Unable to create desktop shortcut because WScript.Shell is unavailable.");
        dynamic? shell = null;
        dynamic? shortcut = null;

        try
        {
            shell = Activator.CreateInstance(shellType);
            shortcut = shell!.CreateShortcut(launcherPath);
            shortcut.TargetPath = launcherExePath;
            shortcut.Arguments = string.Empty;
            shortcut.WorkingDirectory = workingDirectory;
            shortcut.IconLocation = $"{iconPath},0";
            shortcut.Description = LauncherName;
            shortcut.Save();
        }
        finally
        {
            if (shortcut is not null)
            {
                Marshal.FinalReleaseComObject(shortcut);
            }

            if (shell is not null)
            {
                Marshal.FinalReleaseComObject(shell);
            }
        }
    }

    private static string CopyLauncherIcon(string installDirectory)
    {
        var installedIconPath = Path.Combine(installDirectory, $"{LauncherName}.ico");
        var externalIconPath = Path.Combine(AppContext.BaseDirectory, "launcher.ico");
        if (File.Exists(externalIconPath))
        {
            File.Copy(externalIconPath, installedIconPath, overwrite: true);
            return installedIconPath;
        }

        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("launcher.ico");
        if (stream is null)
        {
            return Path.Combine(installDirectory, "Scada.Launcher.exe");
        }

        using var fileStream = File.Create(installedIconPath);
        stream.CopyTo(fileStream);
        return installedIconPath;
    }

    private static void DeleteDesktopLauncher(Action<string> log)
    {
        var desktopDirectory = Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory);
        var launcherPath = Path.Combine(desktopDirectory, $"{LauncherName}.lnk");
        DeleteLegacyUrlLauncher(desktopDirectory);

        if (!File.Exists(launcherPath))
        {
            return;
        }

        File.Delete(launcherPath);
        log($"Deleted desktop shortcut: {launcherPath}");
    }

    private static void DeleteLegacyUrlLauncher(string desktopDirectory)
    {
        var legacyPath = Path.Combine(desktopDirectory, $"{LauncherName}.url");
        if (File.Exists(legacyPath))
        {
            File.Delete(legacyPath);
        }
    }

    private static void CopyDirectory(string sourceDirectory, string destinationDirectory)
    {
        foreach (var directory in Directory.EnumerateDirectories(sourceDirectory, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceDirectory, directory);
            Directory.CreateDirectory(Path.Combine(destinationDirectory, relative));
        }

        foreach (var file in Directory.EnumerateFiles(sourceDirectory, "*", SearchOption.AllDirectories))
        {
            var relative = Path.GetRelativePath(sourceDirectory, file);
            var destinationFile = Path.Combine(destinationDirectory, relative);
            Directory.CreateDirectory(Path.GetDirectoryName(destinationFile)!);
            File.Copy(file, destinationFile, overwrite: true);
        }
    }

    private static void DeleteDirectoryWithRetry(string directory, Action<string> log)
    {
        if (!Directory.Exists(directory))
        {
            return;
        }

        for (var attempt = 1; attempt <= DirectoryDeleteRetryCount; attempt++)
        {
            try
            {
                log($"Removing previous install directory: {directory}");
                Directory.Delete(directory, recursive: true);
                return;
            }
            catch when (attempt < DirectoryDeleteRetryCount)
            {
                Thread.Sleep(DirectoryDeleteRetryDelayMilliseconds);
            }
        }

        Directory.Delete(directory, recursive: true);
    }

    private static void RunProcess(string fileName, string arguments, bool ignoreErrors, Action<string> log, bool suppressMissingServiceMessage = false)
    {
        log($"> {fileName} {arguments}");

        var startInfo = new ProcessStartInfo(fileName, arguments)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = SystemCommandEncoding,
            StandardErrorEncoding = SystemCommandEncoding,
        };

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"Unable to start process: {fileName}");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();

        if (process.ExitCode != 0)
        {
            if (ignoreErrors && suppressMissingServiceMessage && IsMissingServiceMessage(stdout, stderr))
            {
                log("Service was not installed. Cleanup step skipped.");
                return;
            }

            if (ignoreErrors)
            {
                if (!string.IsNullOrWhiteSpace(stderr))
                {
                    log(stderr.Trim());
                }

                return;
            }

            throw new InvalidOperationException($"{fileName} failed with exit code {process.ExitCode}.{Environment.NewLine}{stderr.Trim()}");
        }

        if (!string.IsNullOrWhiteSpace(stdout))
        {
            log(stdout.Trim());
        }
    }

    private static bool IsMissingServiceMessage(string stdout, string stderr)
    {
        return stdout.Contains("1060", StringComparison.OrdinalIgnoreCase) ||
               stderr.Contains("1060", StringComparison.OrdinalIgnoreCase);
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("This installer can only run on Windows.");
        }
    }

    private static void EnsureAdministrator()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        if (!principal.IsInRole(WindowsBuiltInRole.Administrator))
        {
            throw new InvalidOperationException("Administrator privileges are required. Please run the installer as administrator.");
        }
    }

    [DllImport("kernel32.dll")]
    private static extern uint GetOEMCP();
}

internal sealed class InstallerOptions
{
    public static InstallerOptions Default { get; } = new();

    public string InstallDirectory { get; set; } = @"C:\smScada";
    public string ServiceName { get; set; } = "0Scada_ZXC";
    public string ServiceDisplayName { get; set; } = "0Scada_ZXC";
    public int Port { get; set; } = 5000;
}

