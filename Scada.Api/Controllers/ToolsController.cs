using System.Diagnostics;
using Microsoft.AspNetCore.Mvc;

namespace Scada.Api.Controllers;

[ApiController]
[Route("api/tools")]
public sealed class ToolsController : ControllerBase
{
    private static readonly HashSet<string> AllowedHosts = new(StringComparer.OrdinalIgnoreCase)
    {
        "192.168.88.11",
        "192.168.88.12",
    };

    [HttpPost("vnc/open")]
    public ActionResult<VncOpenResponse> OpenVnc([FromBody] VncOpenRequest request)
    {
        var host = request.Host?.Trim() ?? string.Empty;
        if (!AllowedHosts.Contains(host))
        {
            return BadRequest($"Unsupported VNC host: {host}");
        }

        // RealVNC Viewer's executable name is vncviewer.exe.
        var executableCandidates = new[]
        {
            @"C:\Program Files\RealVNC\VNC Viewer\vncviewer.exe",
            @"C:\Program Files (x86)\RealVNC\VNC Viewer\vncviewer.exe",
            "vncviewer.exe",
        };

        foreach (var executable in executableCandidates)
        {
            if (executable.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) && !System.IO.File.Exists(executable) && executable.Contains(':'))
            {
                continue;
            }

            try
            {
                Process.Start(new ProcessStartInfo
                {
                    FileName = executable,
                    Arguments = $"\"{host}:5900\"",
                    UseShellExecute = true,
                });

                return Ok(new VncOpenResponse($"Launched RealVNC ({System.IO.Path.GetFileName(executable)}): {host}:5900"));
            }
            catch
            {
                // Try next executable candidate.
            }
        }

        return StatusCode(500, "Cannot launch RealVNC. Please verify RealVNC Viewer is installed.");
    }

    public sealed record VncOpenRequest(string Host, string? Password);
    public sealed record VncOpenResponse(string Message);
}
