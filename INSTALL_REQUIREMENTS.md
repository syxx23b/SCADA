# SCADA Installation Requirements

## 1. Publish and Deployment

- The project targets Windows deployment.
- Frontend build output must be written to `Scada.Api/wwwroot`.
- The API listens on port `5000` by default.
- Local deployment and verification target `http://localhost:5000`.
- The installer payload source defaults to:
  `Scada.Api/bin/Release/net8.0/win-x64/publish`
- The final installer must embed the payload into the installer executable. It must not depend on an external `payload` folder on the build machine.

## 2. Service Installation

- The installer runs on Windows only.
- The installer must be started with administrator privileges.
- During installation, the previous service must be stopped and deleted first.
- Default installation directory:
  `C:\smScada`
- Default Windows service name:
  `0Scada_ZXC`
- Default Windows service display name:
  `0Scada_ZXC`
- Do not use legacy defaults such as `smScada`, `ScadaApi`, or old Chinese product names for the service identity.
- The application must run as a Windows Service.
- The service account must be `LocalSystem`.
- The registered service command line must include:
  `--urls http://0.0.0.0:5000`
- The service must be configured for automatic startup.
- On failure, the service must restart automatically with a `5000ms` delay.
- The installer must start the service automatically after installation.
- Uninstall must remove the service, firewall rules, desktop shortcut, and installation directory.

## 3. Firewall

- The installer must create a Windows inbound firewall rule automatically.
- The default open port is TCP `5000`.
- The firewall rule name must include the service display name and port.

## 4. Desktop Launcher and Icon

- Installation must create a desktop launcher with an icon.
- The desktop launcher name must be:
  `Cleaning Machine Test Platform`
- The desktop launcher must be a standard Windows `.lnk` shortcut.
- The launcher must open the local SCADA application at:
  `http://localhost:5000/`
- The single source of truth for all product icons is:
  `C:\Users\syxxz\OneDrive\SCADA\logo.svg`
- All icon assets used by the project must be generated from that file, including frontend brand icons, favicon, desktop shortcut icon, launcher icon, and installer icon.
- No other standalone svg/png/ico file may be used as an independent icon source.

## 5. Installer UI

- The installer uses Windows Forms.
- The window is fixed size and centered on startup.
- The installer font is `Microsoft YaHei UI`.
- Installer UI text and runtime logs must use English to avoid garbled text on target machines.
- The UI must expose these fields:
  - Install directory
  - Service name
  - Display name
  - Port
- The install directory must support folder browsing.
- The port input must be numeric and limited to `1-65535`.
- The main actions are:
  - Install and Start
  - Uninstall
  - Exit
- A log panel must show installation steps and command output.
- Buttons must be temporarily disabled while install or uninstall is running.
- Success and error dialogs must be shown after each operation.

## 6. Silent Install

- The installer supports the `--silent` argument.
- With `--silent`, the installer must run with default settings and without showing the UI.

## 7. Product Identity

- Author: `ZhangXC`
- Product/company label: `smScada`
- Default installer product name: `smScada`
- Default API port: `5000`

## 8. Installer Output

- The installer file name must include a timestamp.
- Naming format:
  `SCADA-Setup-YYYY.MM.DD.HHmm.exe`
- Example:
  `SCADA-Setup-2026.06.04.1530.exe`
- The final installer output directory is:
  `C:\Users\syxxz\OneDrive\SCADA`
- Standard packaging entrypoint:
  `Build-Installer.ps1`
- Future installer builds should use `Build-Installer.ps1` so output naming, output path, and cleanup behavior stay consistent.

## 9. Build Cleanup

- After generating the installer, temporary build output should be cleaned so the project directory stays tidy.
- Routine cleanup should remove installer intermediate payload folders and unnecessary `bin` / `obj` build output when packaging is complete.
- This cleanup requirement applies to all future installer builds as well.
- `Build-Installer.ps1` must clean packaging output automatically after each successful or failed installer build.
- Cleanup should remove at least:
  - project `bin` / `obj` directories
  - temporary installer publish directories
  - temporary payload folders
  - `scada-web/dist`
  - transient runtime log files such as `Scada.Api/scada-api-5000.log`
