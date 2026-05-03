namespace Scada.Setup;

internal sealed class MainForm : Form
{
    private readonly TextBox _installPathTextBox;
    private readonly TextBox _serviceNameTextBox;
    private readonly TextBox _displayNameTextBox;
    private readonly NumericUpDown _portNumeric;
    private readonly TextBox _logTextBox;
    private readonly Button _installButton;
    private readonly Button _uninstallButton;
    private readonly Button _browseButton;

    public MainForm()
    {
        Text = "松门电器 SCADA 安装程序";
        StartPosition = FormStartPosition.CenterScreen;
        MinimizeBox = false;
        MaximizeBox = false;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        ClientSize = new Size(820, 620);
        Font = new Font("Microsoft YaHei UI", 9F);

        var header = new Panel
        {
            Dock = DockStyle.Top,
            Height = 140,
            BackColor = Color.FromArgb(32, 49, 80),
            Padding = new Padding(24, 20, 24, 16),
        };

        var title = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Top,
            Height = 44,
            Text = "松门电器 SCADA 服务安装程序",
            ForeColor = Color.White,
            Font = new Font("Microsoft YaHei UI", 16F, FontStyle.Bold),
        };

        var branding = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Top,
            Height = 28,
            Text = "开发：ZhangXC    公司：松门电器",
            ForeColor = Color.FromArgb(224, 233, 255),
            Font = new Font("Microsoft YaHei UI", 10F),
        };

        var tip = new Label
        {
            AutoSize = false,
            Dock = DockStyle.Fill,
            Text = "安装后将先清理旧版本，再创建 Windows 服务并设置为开机自启动。默认开放 TCP 5000 端口。",
            ForeColor = Color.FromArgb(236, 242, 255),
            Font = new Font("Microsoft YaHei UI", 9.5F),
            Padding = new Padding(0, 8, 0, 0),
        };

        header.Controls.Add(tip);
        header.Controls.Add(branding);
        header.Controls.Add(title);
        Controls.Add(header);

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            Location = new Point(0, 140),
            Padding = new Padding(24, 20, 24, 0),
            ColumnCount = 3,
            RowCount = 4,
            AutoSize = true,
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 120));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
        layout.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));

        layout.Controls.Add(MakeLabel("安装目录"), 0, 0);
        _installPathTextBox = MakeTextBox(InstallerOptions.Default.InstallDirectory);
        layout.Controls.Add(_installPathTextBox, 1, 0);
        _browseButton = MakeButton("浏览");
        _browseButton.Click += BrowseButtonOnClick;
        layout.Controls.Add(_browseButton, 2, 0);

        layout.Controls.Add(MakeLabel("服务名称"), 0, 1);
        _serviceNameTextBox = MakeTextBox(InstallerOptions.Default.ServiceName);
        layout.Controls.Add(_serviceNameTextBox, 1, 1);
        layout.SetColumnSpan(_serviceNameTextBox, 2);

        layout.Controls.Add(MakeLabel("显示名称"), 0, 2);
        _displayNameTextBox = MakeTextBox(InstallerOptions.Default.ServiceDisplayName);
        layout.Controls.Add(_displayNameTextBox, 1, 2);
        layout.SetColumnSpan(_displayNameTextBox, 2);

        layout.Controls.Add(MakeLabel("监听端口"), 0, 3);
        _portNumeric = new NumericUpDown
        {
            Minimum = 1,
            Maximum = 65535,
            Value = InstallerOptions.Default.Port,
            Dock = DockStyle.Fill,
        };
        layout.Controls.Add(_portNumeric, 1, 3);
        layout.SetColumnSpan(_portNumeric, 2);

        Controls.Add(layout);

        var buttonPanel = new FlowLayoutPanel
        {
            Dock = DockStyle.Top,
            Height = 58,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(24, 12, 24, 0),
        };

        _installButton = MakePrimaryButton("安装并启动");
        _installButton.Click += InstallButtonOnClick;
        _uninstallButton = MakeButton("卸载");
        _uninstallButton.Click += UninstallButtonOnClick;
        var closeButton = MakeButton("退出");
        closeButton.Click += (_, _) => Close();

        buttonPanel.Controls.Add(closeButton);
        buttonPanel.Controls.Add(_uninstallButton);
        buttonPanel.Controls.Add(_installButton);
        Controls.Add(buttonPanel);

        _logTextBox = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Dock = DockStyle.Fill,
            Font = new Font("Microsoft YaHei UI", 9F),
            BackColor = Color.White,
            BorderStyle = BorderStyle.FixedSingle,
        };
        _logTextBox.AppendText("准备就绪。点击“安装并启动”开始部署。");
        Controls.Add(_logTextBox);

        Controls.SetChildIndex(_logTextBox, 0);
        Controls.SetChildIndex(buttonPanel, 1);
        Controls.SetChildIndex(layout, 2);
        Controls.SetChildIndex(header, 3);
    }

    private static Label MakeLabel(string text)
    {
        return new Label
        {
            Text = text,
            Dock = DockStyle.Fill,
            TextAlign = ContentAlignment.MiddleLeft,
            Padding = new Padding(0, 0, 8, 0),
        };
    }

    private static TextBox MakeTextBox(string text)
    {
        return new TextBox
        {
            Dock = DockStyle.Fill,
            Text = text,
        };
    }

    private static Button MakeButton(string text)
    {
        return new Button
        {
            Text = text,
            Width = 88,
            Height = 32,
        };
    }

    private static Button MakePrimaryButton(string text)
    {
        return new Button
        {
            Text = text,
            Width = 112,
            Height = 32,
            BackColor = Color.FromArgb(43, 111, 214),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
        };
    }

    private void BrowseButtonOnClick(object? sender, EventArgs e)
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择安装目录",
            UseDescriptionForTitle = true,
            SelectedPath = _installPathTextBox.Text,
        };

        if (dialog.ShowDialog(this) == DialogResult.OK)
        {
            _installPathTextBox.Text = dialog.SelectedPath;
        }
    }

    private async void InstallButtonOnClick(object? sender, EventArgs e)
    {
        await RunInstallerAsync(() =>
        {
            var options = ReadOptions();
            InstallerEngine.Install(options, AppendLog);
        });
    }

    private async void UninstallButtonOnClick(object? sender, EventArgs e)
    {
        await RunInstallerAsync(() =>
        {
            var options = ReadOptions();
            InstallerEngine.Uninstall(options, AppendLog);
        });
    }

    private InstallerOptions ReadOptions()
    {
        return new InstallerOptions
        {
            InstallDirectory = _installPathTextBox.Text.Trim(),
            ServiceName = _serviceNameTextBox.Text.Trim(),
            ServiceDisplayName = _displayNameTextBox.Text.Trim(),
            Port = (int)_portNumeric.Value,
        };
    }

    private async Task RunInstallerAsync(Action action)
    {
        SetBusy(true);
        AppendLog(string.Empty);
        try
        {
            InstallerEngine.EnsureReady();
            await Task.Run(action);
            MessageBox.Show(this, "操作完成。", "松门电器 SCADA 安装程序", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception exception)
        {
            AppendLog(exception.Message);
            MessageBox.Show(this, exception.Message, "松门电器 SCADA 安装程序", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void SetBusy(bool busy)
    {
        _installButton.Enabled = !busy;
        _uninstallButton.Enabled = !busy;
        _browseButton.Enabled = !busy;
        UseWaitCursor = busy;
    }

    private void AppendLog(string message)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action<string>(AppendLog), message);
            return;
        }

        if (!string.IsNullOrWhiteSpace(message))
        {
            _logTextBox.AppendText(Environment.NewLine + message);
        }
    }
}
