using System.Diagnostics;
using System.Management;
using System.Runtime.InteropServices;
using System.Text;

namespace Scada.Launcher;

internal static class Program
{
    private const string MutexName = @"Global\ScadaLauncherSingleton";
    private const string LauncherUrl = "http://localhost:5000/";
    private const string UserDataDirectoryName = "0Scada_ZXC_EdgeApp";

    [STAThread]
    private static void Main()
    {
        Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);

        using var mutex = new Mutex(true, MutexName, out var createdNew);
        if (!createdNew)
        {
            ActivateExistingEdgeWindow(waitForWindow: true);
            return;
        }

        if (ActivateExistingEdgeWindow(waitForWindow: false))
        {
            return;
        }

        StartEdgeApp();
        ActivateExistingEdgeWindow(waitForWindow: true);
    }

    private static void StartEdgeApp()
    {
        var edgePath = ResolveEdgePath()
            ?? throw new FileNotFoundException("Microsoft Edge was not found on this machine.");

        var userDataDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            UserDataDirectoryName);
        Directory.CreateDirectory(userDataDir);

        var startInfo = new ProcessStartInfo
        {
            FileName = edgePath,
            UseShellExecute = true
        };
        startInfo.ArgumentList.Add($"--app={LauncherUrl}");
        startInfo.ArgumentList.Add($"--user-data-dir={userDataDir}");
        startInfo.ArgumentList.Add("--disable-features=msExtensionsHub");
        startInfo.ArgumentList.Add("--no-first-run");

        Process.Start(startInfo);
    }

    private static bool ActivateExistingEdgeWindow(bool waitForWindow)
    {
        var timeoutAt = waitForWindow ? DateTime.UtcNow.AddSeconds(8) : DateTime.UtcNow;

        do
        {
            var process = FindExistingEdgeAppProcess();
            if (process is not null)
            {
                try
                {
                    var handle = process.MainWindowHandle;
                    if (handle != IntPtr.Zero)
                    {
                        ShowWindowAsync(handle, 9);
                        SetForegroundWindow(handle);
                        return true;
                    }
                }
                finally
                {
                    process.Dispose();
                }
            }

            Thread.Sleep(250);
        }
        while (DateTime.UtcNow < timeoutAt);

        return false;
    }

    private static Process? FindExistingEdgeAppProcess()
    {
        foreach (var process in Process.GetProcessesByName("msedge"))
        {
            try
            {
                if (process.HasExited)
                {
                    process.Dispose();
                    continue;
                }

                var commandLine = TryGetCommandLine(process);
                if (string.IsNullOrWhiteSpace(commandLine))
                {
                    process.Dispose();
                    continue;
                }

                if (!commandLine.Contains($"--app={LauncherUrl}", StringComparison.OrdinalIgnoreCase))
                {
                    process.Dispose();
                    continue;
                }

                return process;
            }
            catch
            {
                process.Dispose();
            }
        }

        return null;
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

    private static string? ResolveEdgePath()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Microsoft", "Edge", "Application", "msedge.exe")
        };

        return candidates.FirstOrDefault(File.Exists);
    }

    [DllImport("user32.dll")]
    private static extern bool SetForegroundWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow);
}
