using System.Windows.Forms;
using Scada.Setup;
using System.Text;

Encoding.RegisterProvider(CodePagesEncodingProvider.Instance);
ApplicationConfiguration.Initialize();

if (Environment.GetCommandLineArgs().Any(arg => arg.Equals("--silent", StringComparison.OrdinalIgnoreCase)))
{
    var options = InstallerOptions.Default;
    InstallerEngine.Install(options, message => Console.WriteLine(message));
    return;
}

Application.Run(new MainForm());
