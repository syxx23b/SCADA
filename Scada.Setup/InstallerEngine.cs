using System.Diagnostics;
using System.Security.Principal;
using System.Text;

namespace Scada.Setup;

internal static class InstallerEngine
{
    public static void Install(InstallerOptions options, Action<string> log)
    {
        EnsureWindows();
        EnsureAdministrator();

        var payloadRoot = Path.Combine(AppContext.BaseDirectory, "payload");
        if (!Directory.Exists(payloadRoot))
        {
            throw new DirectoryNotFoundException($"找不到安装包内容：{payloadRoot}");
        }

        var installDir = Path.GetFullPath(options.InstallDirectory);
        StopAndDeleteService(options, log);
        DeleteDirectoryWithRetry(installDir, log);
        Directory.CreateDirectory(installDir);

        log($"开始复制文件到：{installDir}");
        CopyDirectory(payloadRoot, installDir);

        var serviceExe = Path.Combine(installDir, "Scada.Api.exe");
        var binPath = $"\"{serviceExe}\" --urls http://0.0.0.0:{options.Port}";

        log($"正在注册服务：{options.ServiceName}");
        RunProcess(
            "sc.exe",
            $"create {options.ServiceName} binPath= \"{binPath}\" start= auto DisplayName= \"{options.ServiceDisplayName}\" obj= LocalSystem",
            ignoreErrors: false,
            log);
        RunProcess("sc.exe", $"description {options.ServiceName} \"松门电器 SCADA 服务\"", ignoreErrors: false, log);
        RunProcess("sc.exe", $"failure {options.ServiceName} reset= 86400 actions= restart/5000/restart/5000/restart/5000", ignoreErrors: true, log);

        ConfigureFirewall(options, log);

        RunProcess("sc.exe", $"start {options.ServiceName}", ignoreErrors: false, log);

        log("安装完成。");
        log($"服务名称：{options.ServiceName}");
        log($"访问地址：http://127.0.0.1:{options.Port}");
    }

    public static void Uninstall(InstallerOptions options, Action<string> log)
    {
        EnsureWindows();
        EnsureAdministrator();

        StopAndDeleteService(options, log);
        RunProcess("netsh", $"advfirewall firewall delete rule name=\"{options.ServiceDisplayName} TCP {options.Port}\"", ignoreErrors: true, log);

        if (Directory.Exists(options.InstallDirectory))
        {
            Directory.Delete(options.InstallDirectory, recursive: true);
        }

        log("卸载完成。");
    }

    public static void EnsureReady()
    {
        EnsureWindows();
        EnsureAdministrator();
    }

    private static void StopAndDeleteService(InstallerOptions options, Action<string> log)
    {
        RunProcess("sc.exe", $"stop {options.ServiceName}", ignoreErrors: true, log);
        RunProcess("sc.exe", $"delete {options.ServiceName}", ignoreErrors: true, log);
    }

    private static void ConfigureFirewall(InstallerOptions options, Action<string> log)
    {
        var ruleName = $"{options.ServiceDisplayName} TCP {options.Port}";
        RunProcess("netsh", $"advfirewall firewall delete rule name=\"{ruleName}\"", ignoreErrors: true, log);
        RunProcess("netsh", $"advfirewall firewall add rule name=\"{ruleName}\" dir=in action=allow protocol=TCP localport={options.Port}", ignoreErrors: false, log);
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

        for (var attempt = 1; attempt <= 5; attempt++)
        {
            try
            {
                log($"正在清理旧版本：{directory}");
                Directory.Delete(directory, recursive: true);
                return;
            }
            catch when (attempt < 5)
            {
                Thread.Sleep(1000);
            }
        }

        Directory.Delete(directory, recursive: true);
    }

    private static void RunProcess(string fileName, string arguments, bool ignoreErrors, Action<string> log)
    {
        log($"> {fileName} {arguments}");

        var startInfo = new ProcessStartInfo(fileName, arguments)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };

        using var process = Process.Start(startInfo) ?? throw new InvalidOperationException($"无法启动进程：{fileName}");
        var stdout = process.StandardOutput.ReadToEnd();
        var stderr = process.StandardError.ReadToEnd();
        process.WaitForExit();

        if (!string.IsNullOrWhiteSpace(stdout))
        {
            log(stdout.Trim());
        }

        if (process.ExitCode != 0)
        {
            if (ignoreErrors)
            {
                if (!string.IsNullOrWhiteSpace(stderr))
                {
                    log(stderr.Trim());
                }

                return;
            }

            throw new InvalidOperationException($"{fileName} 执行失败，退出码 {process.ExitCode}。{stderr.Trim()}");
        }
    }

    private static void EnsureWindows()
    {
        if (!OperatingSystem.IsWindows())
        {
            throw new PlatformNotSupportedException("该安装程序只能在 Windows 上运行。");
        }
    }

    private static void EnsureAdministrator()
    {
        using var identity = WindowsIdentity.GetCurrent();
        var principal = new WindowsPrincipal(identity);
        if (!principal.IsInRole(WindowsBuiltInRole.Administrator))
        {
            throw new InvalidOperationException("安装程序需要管理员权限，请右键以管理员身份运行。");
        }
    }
}

internal sealed class InstallerOptions
{
    public static InstallerOptions Default { get; } = new();

    public string InstallDirectory { get; set; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "松门电器SCADA");
    public string ServiceName { get; set; } = "ScadaApi";
    public string ServiceDisplayName { get; set; } = "松门电器 SCADA";
    public int Port { get; set; } = 5000;
}
