using System.Windows.Forms;
using Scada.Setup;

ApplicationConfiguration.Initialize();

if (Environment.GetCommandLineArgs().Any(arg => arg.Equals("--silent", StringComparison.OrdinalIgnoreCase)))
{
    var options = InstallerOptions.Default;
    InstallerEngine.Install(options, message => Console.WriteLine(message));
    return;
}

Application.Run(new MainForm());
