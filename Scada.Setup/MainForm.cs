namespace Scada.Setup;

internal sealed class MainForm : Form
{
    private static readonly Color ShellBackColor = Color.FromArgb(241, 245, 249);
    private static readonly Color HeaderBackColor = Color.FromArgb(29, 45, 78);
    private static readonly Color HeaderAccentColor = Color.FromArgb(166, 189, 236);
    private static readonly Color HeaderMetaColor = Color.FromArgb(180, 198, 231);
    private static readonly Color CardBorderColor = Color.FromArgb(231, 237, 247);
    private static readonly Color CardTitleColor = Color.FromArgb(34, 40, 52);
    private static readonly Color LabelColor = Color.FromArgb(99, 107, 132);
    private static readonly Color InputBackColor = Color.FromArgb(247, 249, 255);
    private static readonly Color InputBorderColor = Color.FromArgb(215, 221, 234);
    private static readonly Color PrimaryBlue = Color.FromArgb(0, 95, 135);
    private static readonly Color PrimaryBlueHover = Color.FromArgb(0, 82, 117);
    private static readonly Color PrimaryBluePressed = Color.FromArgb(0, 70, 100);
    private static readonly Color SecondaryTextColor = Color.FromArgb(37, 52, 77);

    private const string WindowTitle = "SCADA 安装程序";
    private const string HeaderEyebrow = "INSTALLER";
    private const string HeaderTitle = "SCADA 服务安装程序";
    private const string HeaderSubtitle = "用于安装、覆盖或卸载本机 SCADA 服务程序包，并自动注册服务、端口规则和桌面入口。";
    private const string HeaderMeta = "作者 ZhangXC    产品 smScada    Windows 服务部署";
    private const string ProfileEyebrow = "DEPLOYMENT CONFIG";
    private const string ProfileTitle = "部署配置";
    private const string ProfileSubtitle = "按照数据看板的结构化样式展示安装参数，支持在安装前调整目录、服务标识和端口。";
    private const string LogEyebrow = "RUNTIME LOGS";
    private const string LogTitle = "操作日志";
    private const string LogSubtitle = "安装步骤、服务操作和命令输出会持续追加在这里。";
    private const string InstallButtonText = "安装并启动";
    private const string UninstallButtonText = "卸载";
    private const string ExitButtonText = "退出";
    private const string BrowseButtonText = "浏览";
    private const string ReadyLogText = "Ready. Click \"Install and Start\" to deploy.";
    private const string CompletedMessage = "操作已完成。";
    private const string InstallDirectoryLabel = "安装目录";
    private const string ServiceNameLabel = "服务名称";
    private const string ServiceDisplayNameLabel = "显示名称";
    private const string PortLabel = "端口";

    private TextBox _installDirectoryTextBox = null!;
    private TextBox _serviceNameTextBox = null!;
    private TextBox _serviceDisplayNameTextBox = null!;
    private NumericUpDown _portNumeric = null!;
    private TextBox _logTextBox = null!;
    private Button _installButton = null!;
    private Button _uninstallButton = null!;
    private Button _browseButton = null!;

    public MainForm()
    {
        Text = WindowTitle;
        StartPosition = FormStartPosition.CenterScreen;
        MinimizeBox = false;
        MaximizeBox = false;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        ClientSize = new Size(1024, 820);
        MinimumSize = new Size(1024, 820);
        BackColor = ShellBackColor;
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
            BackColor = ShellBackColor,
            Padding = new Padding(24, 24, 24, 24),
        };
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 170));
        root.RowStyles.Add(new RowStyle(SizeType.Absolute, 318));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        Controls.Add(root);
        root.Controls.Add(BuildHeader(), 0, 0);
        root.Controls.Add(BuildSettingsCard(), 0, 1);
        root.Controls.Add(BuildLogPanel(), 0, 2);
    }

    private Control BuildHeader()
    {
        var header = CreateCardPanel();
        header.BackColor = HeaderBackColor;
        header.Padding = new Padding(28, 22, 28, 22);
        header.Margin = new Padding(0, 0, 0, 18);

        var eyebrow = new Label
        {
            AutoSize = true,
            Text = HeaderEyebrow,
            ForeColor = HeaderAccentColor,
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
            Location = new Point(0, 0),
        };

        var title = new Label
        {
            AutoSize = true,
            Text = HeaderTitle,
            ForeColor = Color.White,
            Font = new Font("Microsoft YaHei UI", 21F, FontStyle.Bold),
            Location = new Point(0, 28),
        };

        var subtitle = new Label
        {
            AutoSize = false,
            Size = new Size(820, 42),
            Text = HeaderSubtitle,
            ForeColor = Color.FromArgb(223, 232, 248),
            Font = new Font("Microsoft YaHei UI", 10F),
            Location = new Point(0, 72),
        };

        var meta = new Label
        {
            AutoSize = true,
            Text = HeaderMeta,
            ForeColor = HeaderMetaColor,
            Font = new Font("Microsoft YaHei UI", 9F),
            Location = new Point(0, 120),
        };

        header.Controls.Add(eyebrow);
        header.Controls.Add(title);
        header.Controls.Add(subtitle);
        header.Controls.Add(meta);
        return header;
    }

    private Control BuildSettingsCard()
    {
        var card = CreateCardPanel();
        card.Padding = new Padding(24, 22, 24, 22);
        card.Margin = new Padding(0, 0, 0, 18);

        var eyebrow = CreateSectionEyebrow(ProfileEyebrow);
        eyebrow.Location = new Point(0, 0);

        var title = CreateSectionTitle(ProfileTitle);
        title.Location = new Point(0, 20);

        var subtitle = CreateSectionSubtitle(ProfileSubtitle, 920);
        subtitle.Location = new Point(0, 50);

        var formGrid = new TableLayoutPanel
        {
            Location = new Point(0, 92),
            Size = new Size(928, 128),
            ColumnCount = 2,
            RowCount = 2,
            BackColor = Color.Transparent,
            Margin = new Padding(0),
            Padding = new Padding(0),
        };
        formGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
        formGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 50F));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Percent, 50F));
        formGrid.RowStyles.Add(new RowStyle(SizeType.Percent, 50F));

        _installDirectoryTextBox = CreateInputTextBox(InstallerOptions.Default.InstallDirectory);
        _serviceNameTextBox = CreateInputTextBox(InstallerOptions.Default.ServiceName);
        _serviceDisplayNameTextBox = CreateInputTextBox(InstallerOptions.Default.ServiceDisplayName);
        _portNumeric = CreatePortInput(InstallerOptions.Default.Port);

        formGrid.Controls.Add(CreateFieldPanel(InstallDirectoryLabel, _installDirectoryTextBox, CreateBrowseButton()), 0, 0);
        formGrid.Controls.Add(CreateFieldPanel(ServiceNameLabel, _serviceNameTextBox), 1, 0);
        formGrid.Controls.Add(CreateFieldPanel(ServiceDisplayNameLabel, _serviceDisplayNameTextBox), 0, 1);
        formGrid.Controls.Add(CreateFieldPanel(PortLabel, _portNumeric), 1, 1);

        var actionStrip = new FlowLayoutPanel
        {
            FlowDirection = FlowDirection.RightToLeft,
            WrapContents = false,
            AutoSize = false,
            Location = new Point(0, 238),
            Size = new Size(928, 42),
            Margin = new Padding(0),
            Padding = new Padding(0),
            BackColor = Color.Transparent,
        };

        _installButton = MakePrimaryButton(InstallButtonText, 152);
        _installButton.Click += InstallButtonOnClick;
        _uninstallButton = MakeSecondaryButton(UninstallButtonText, 104);
        _uninstallButton.Click += UninstallButtonOnClick;
        var closeButton = MakeSecondaryButton(ExitButtonText, 88);
        closeButton.Click += (_, _) => Close();

        actionStrip.Controls.Add(closeButton);
        actionStrip.Controls.Add(_uninstallButton);
        actionStrip.Controls.Add(_installButton);

        card.Controls.Add(eyebrow);
        card.Controls.Add(title);
        card.Controls.Add(subtitle);
        card.Controls.Add(formGrid);
        card.Controls.Add(actionStrip);
        return card;
    }

    private Control BuildLogPanel()
    {
        var card = CreateCardPanel();
        card.Padding = new Padding(24, 22, 24, 22);

        var eyebrow = CreateSectionEyebrow(LogEyebrow);
        eyebrow.Location = new Point(0, 0);

        var title = CreateSectionTitle(LogTitle);
        title.Location = new Point(0, 20);

        var subtitle = CreateSectionSubtitle(LogSubtitle, 920);
        subtitle.Location = new Point(0, 50);

        _logTextBox = new TextBox
        {
            Multiline = true,
            ReadOnly = true,
            ScrollBars = ScrollBars.Vertical,
            Location = new Point(0, 92),
            Size = new Size(928, 186),
            Font = new Font("Consolas", 10F),
            BackColor = InputBackColor,
            ForeColor = CardTitleColor,
            BorderStyle = BorderStyle.FixedSingle,
        };
        _logTextBox.AppendText(ReadyLogText);

        card.Controls.Add(eyebrow);
        card.Controls.Add(title);
        card.Controls.Add(subtitle);
        card.Controls.Add(_logTextBox);
        return card;
    }

    private static Panel CreateCardPanel()
    {
        return new Panel
        {
            Dock = DockStyle.Fill,
            BackColor = Color.White,
            Margin = new Padding(0),
            BorderStyle = BorderStyle.FixedSingle,
        };
    }

    private static Label CreateSectionEyebrow(string text)
    {
        return new Label
        {
            AutoSize = true,
            Text = text,
            ForeColor = PrimaryBlue,
            Font = new Font("Microsoft YaHei UI", 8.5F, FontStyle.Bold),
        };
    }

    private static Label CreateSectionTitle(string text)
    {
        return new Label
        {
            AutoSize = true,
            Text = text,
            ForeColor = CardTitleColor,
            Font = new Font("Microsoft YaHei UI", 13F, FontStyle.Bold),
        };
    }

    private static Label CreateSectionSubtitle(string text, int width)
    {
        return new Label
        {
            AutoSize = false,
            Text = text,
            Size = new Size(width, 32),
            ForeColor = LabelColor,
            Font = new Font("Microsoft YaHei UI", 9F),
        };
    }

    private Panel CreateFieldPanel(string labelText, Control inputControl, Control? trailingControl = null)
    {
        var panel = new Panel
        {
            Dock = DockStyle.Fill,
            Margin = new Padding(0, 0, 18, 14),
            BackColor = Color.Transparent,
        };

        var label = new Label
        {
            AutoSize = true,
            Text = labelText,
            ForeColor = LabelColor,
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
            Location = new Point(0, 0),
        };

        inputControl.Location = new Point(0, 26);
        inputControl.Size = trailingControl is null ? new Size(430, 36) : new Size(336, 36);

        panel.Controls.Add(label);
        panel.Controls.Add(inputControl);

        if (trailingControl is not null)
        {
            trailingControl.Location = new Point(348, 26);
            trailingControl.Size = new Size(82, 36);
            panel.Controls.Add(trailingControl);
        }

        return panel;
    }

    private Button CreateBrowseButton()
    {
        _browseButton = MakeSecondaryButton(BrowseButtonText, 82);
        _browseButton.Margin = new Padding(0);
        _browseButton.Click += BrowseButtonOnClick;
        return _browseButton;
    }

    private void BrowseButtonOnClick(object? sender, EventArgs e)
    {
        using var dialog = new FolderBrowserDialog
        {
            Description = "选择安装目录",
            SelectedPath = _installDirectoryTextBox.Text
        };

        if (dialog.ShowDialog(this) == DialogResult.OK && !string.IsNullOrWhiteSpace(dialog.SelectedPath))
        {
            _installDirectoryTextBox.Text = dialog.SelectedPath;
        }
    }

    private static TextBox CreateInputTextBox(string value)
    {
        return new TextBox
        {
            Text = value,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = InputBackColor,
            ForeColor = SecondaryTextColor,
            Font = new Font("Microsoft YaHei UI", 9.5F),
            Margin = new Padding(0),
        };
    }

    private static NumericUpDown CreatePortInput(int value)
    {
        return new NumericUpDown
        {
            Minimum = 1,
            Maximum = 65535,
            Value = value,
            BorderStyle = BorderStyle.FixedSingle,
            BackColor = InputBackColor,
            ForeColor = SecondaryTextColor,
            Font = new Font("Microsoft YaHei UI", 9.5F),
            Margin = new Padding(0),
            TextAlign = HorizontalAlignment.Left,
        };
    }

    private static Button MakeSecondaryButton(string text, int width)
    {
        var button = new Button
        {
            Text = text,
            Width = width,
            Height = 36,
            BackColor = Color.White,
            ForeColor = SecondaryTextColor,
            FlatStyle = FlatStyle.Flat,
            Margin = new Padding(8, 0, 0, 0),
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
        };
        button.FlatAppearance.BorderColor = InputBorderColor;
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
            BackColor = PrimaryBlue,
            ForeColor = Color.White,
            FlatStyle = FlatStyle.Flat,
            Margin = new Padding(8, 0, 0, 0),
            Font = new Font("Microsoft YaHei UI", 9F, FontStyle.Bold),
        };
        button.FlatAppearance.BorderSize = 0;
        button.FlatAppearance.MouseOverBackColor = PrimaryBlueHover;
        button.FlatAppearance.MouseDownBackColor = PrimaryBluePressed;
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
            InstallDirectory = _installDirectoryTextBox.Text.Trim(),
            ServiceName = _serviceNameTextBox.Text.Trim(),
            ServiceDisplayName = _serviceDisplayNameTextBox.Text.Trim(),
            Port = decimal.ToInt32(_portNumeric.Value),
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
            MessageBox.Show(this, CompletedMessage, WindowTitle, MessageBoxButtons.OK, MessageBoxIcon.Information);
        }
        catch (Exception exception)
        {
            AppendLog(exception.Message);
            MessageBox.Show(this, exception.Message, WindowTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
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
