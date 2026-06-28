namespace Scada.Setup;

internal sealed class MainForm : Form
{
    private TextBox _logTextBox;
    private Button _installButton;
    private Button _uninstallButton;

    public MainForm()
    {
        Text = "SCADA 安装程序";
        StartPosition = FormStartPosition.CenterScreen;
        MinimizeBox = false;
        MaximizeBox = false;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        ClientSize = new Size(980, 780);
        MinimumSize = new Size(980, 780);
        BackColor = Color.FromArgb(240, 244, 250);
        Font = new Font("Microsoft YaHei UI", 9F);

        var iconPath = Path.Combine(AppContext.BaseDirectory, "launcher.ico");
        if (File.Exists(iconPath))
        {
            Icon = new Icon(iconPath);
        }

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            RowCount = 3,
            BackColor = BackColor,
            Padding = new Padding(0),
        };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 168));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 220));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        Controls.Add(root);

        root.Controls.Add(BuildHeader(), 0, 0);
        root.Controls.Add(BuildSettingsCard(), 0, 1);
        root.Controls.Add(BuildLogPanel(), 0, 2);
    }

    private Control BuildHeader()
    {
        var header = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.FromArgb(29, 45, 78),
            Padding = new Padding(32, 24, 32, 24),
        };

        var eyebrow = new Label
        {
            AutoSize = true,
            Text = "Windows 服务部署",
            ForeColor = Color.FromArgb(166, 189, 236),
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
            Location = new Point(0, 0),
        };

        var title = new Label
        {
            AutoSize = true,
            Text = "SCADA 服务安装程序",
            ForeColor = Color.White,
            Font = new Font("Microsoft YaHei UI", 20F, FontStyle.Bold),
            Location = new Point(0, 30),
        };

        var subtitle = new Label
        {
            AutoSize = false,
            Size = new Size(760, 52),
            Text = "用于安装、覆盖或卸载本机 SCADA 服务程序包。安装器会使用内置部署配置，并自动创建 Windows 服务和桌面快捷方式。",
            ForeColor = Color.FromArgb(223, 232, 248),
            Font = new Font("Microsoft YaHei UI", 10F),
            Location = new Point(0, 76),
        };

        var meta = new Label
        {
            AutoSize = true,
            Text = "作者  ZhangXC      产品  smScada      固定部署配置",
            ForeColor = Color.FromArgb(180, 198, 231),
            Font = new Font("Microsoft YaHei UI", 9F),
            Location = new Point(0, 126),
        };

        header.Controls.Add(meta);
        header.Controls.Add(subtitle);
        header.Controls.Add(title);
        header.Controls.Add(eyebrow);
        return header;
    }

    private Control BuildSettingsCard()
    {
        var host = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = BackColor,
            Padding = new Padding(24, 20, 24, 12),
        };

        var card = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.White,
            Padding = new Padding(24, 20, 24, 20),
        };
        host.Controls.Add(card);

        var title = new Label
        {
            AutoSize = true,
            Text = "部署配置",
            ForeColor = Color.FromArgb(28, 37, 54),
            Font = new Font("Microsoft YaHei UI", 12F, FontStyle.Bold),
            Location = new Point(0, 0),
        };

        var subtitle = new Label
        {
            AutoSize = true,
            Text = "该安装包中的安装目录、服务标识和端口为固定配置，不可修改。",
            ForeColor = Color.FromArgb(96, 108, 128),
            Font = new Font("Microsoft YaHei UI", 9F),
            Location = new Point(0, 28),
        };

        var summaryPanel = new Panel
        {
            Location = new Point(0, 64),
            Size = new Size(884, 64),
            BackColor = Color.White,
        };

        var summary = new Label
        {
            AutoSize = false,
            Size = new Size(884, 64),
            Text = "安装目录: C:\\smScada\r\n服务名称: 0Scada_ZXC\r\n端口: 5000",
            ForeColor = Color.FromArgb(45, 57, 77),
            Font = new Font("Segoe UI", 11F),
            Padding = new Padding(0, 4, 0, 0),
        };
        summaryPanel.Controls.Add(summary);

        var buttonPanel = new FlowLayoutPanel
        {
            AutoSize = true,
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            Location = new Point(0, 144),
            Width = 884,
            Height = 44,
            Margin = new Padding(0),
            Padding = new Padding(0, 8, 0, 0),
        };

        _installButton = MakePrimaryButton("安装并启动", 156);
        _installButton.Click += InstallButtonOnClick;
        _uninstallButton = MakeSecondaryButton("卸载", 104);
        _uninstallButton.Click += UninstallButtonOnClick;
        var closeButton = MakeSecondaryButton("退出", 84);
        closeButton.Click += (_, _) => Close();

        buttonPanel.Controls.Add(closeButton);
        buttonPanel.Controls.Add(_uninstallButton);
        buttonPanel.Controls.Add(_installButton);

        card.Controls.Add(buttonPanel);
        card.Controls.Add(summaryPanel);
        card.Controls.Add(subtitle);
        card.Controls.Add(title);
        return host;
    }

    private Control BuildLogPanel()
    {
        var host = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = BackColor,
            Padding = new Padding(24, 8, 24, 24),
        };

        var panel = new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.White,
            Padding = new Padding(24, 20, 24, 20),
        };
        host.Controls.Add(panel);

        var title = new Label
        {
            AutoSize = true,
            Text = "操作日志",
            ForeColor = Color.FromArgb(28, 37, 54),
            Font = new Font("Microsoft YaHei UI", 12F, FontStyle.Bold),
            Location = new Point(0, 0),
        };

        var subtitle = new Label
        {
            AutoSize = true,
            Text = "安装步骤、服务操作和命令输出会显示在这里。",
            ForeColor = Color.FromArgb(96, 108, 128),
            Font = new Font("Microsoft YaHei UI", 9F),
            Location = new Point(0, 28),
        };

        _logTextBox = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Location = new Point(0, 60),
            Size = new Size(884, 230),
            Font = new Font("Consolas", 10F),
            BackColor = Color.FromArgb(248, 250, 253),
            ForeColor = Color.FromArgb(34, 41, 56),
            BorderStyle = BorderStyle.FixedSingle,
        };
        _logTextBox.AppendText("准备就绪。点击“安装并启动”开始部署。");

        panel.Controls.Add(_logTextBox);
        panel.Controls.Add(subtitle);
        panel.Controls.Add(title);
        return host;
    }

    private static Button MakeSecondaryButton(string text, int width)
    {
        var button = new Button
        {
            Text = text,
            Width = width,
            Height = 36,
            BackColor = Color.White,
            ForeColor = Color.FromArgb(37, 52, 77),
            FlatStyle = FlatStyle.Flat,
            Margin = new Padding(8, 0, 0, 0),
        };
        button.FlatAppearance.BorderColor = Color.FromArgb(208, 216, 229);
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(246, 248, 252);
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(236, 241, 248);
        return button;
    }

    private static Button MakePrimaryButton(string text, int width)
    {
        var button = new Button
        {
            Text = text,
            Width = width,
            Height = 36,
            BackColor = Color.FromArgb(49, 103, 214),
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Margin = new Padding(8, 0, 0, 0),
        };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = Color.FromArgb(40, 91, 197);
        button.FlatAppearance.MouseDownBackColor = Color.FromArgb(32, 79, 176);
        return button;
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
            InstallDirectory = InstallerOptions.Default.InstallDirectory,
            ServiceName = InstallerOptions.Default.ServiceName,
            ServiceDisplayName = InstallerOptions.Default.ServiceDisplayName,
            Port = InstallerOptions.Default.Port,
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
            MessageBox.Show(this, "操作已完成。", "SCADA 安装程序", MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception exception)
        {
            AppendLog(exception.Message);
            MessageBox.Show(this, exception.Message, "SCADA 安装程序", MessageBoxButtons.OK, MessageBoxIcon.Error);
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
        UseWaitCursor = busy;
    }

    private void AppendLog(string message)
    {
        if (InvokeRequired)
        {
            BeginInvoke(new Action<string>(AppendLog), message);
            return;
        }

        if (string.IsNullOrWhiteSpace(message))
        {
            return;
        }

        if (_logTextBox.TextLength > 0)
        {
            _logTextBox.AppendText(Environment.NewLine);
        }

        _logTextBox.AppendText(message);
        _logTextBox.SelectionStart = _logTextBox.TextLength;
        _logTextBox.ScrollToCaret();
    }
}
