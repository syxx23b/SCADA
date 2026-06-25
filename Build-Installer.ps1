$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$installerOutputRoot = 'C:\Users\syxxz\OneDrive\SCADA'
$techStackNodeModules = 'C:\Users\syxxz\OneDrive\SCADA\Tech Stack\Scada_Codex_Siemens\node_modules'
$scadaWebDir = Join-Path $repoRoot 'scada-web'
$workspaceNodeModulesLink = Join-Path $repoRoot 'node_modules'
$webNodeModulesLink = Join-Path $scadaWebDir 'node_modules'
$apiProject = Join-Path $repoRoot 'Scada.Api\Scada.Api.csproj'
$setupProject = Join-Path $repoRoot 'Scada.Setup\Scada.Setup.csproj'
$tempPublishRoot = Join-Path ([System.IO.Path]::GetTempPath()) ('ScadaSetupBuild-' + [System.Guid]::NewGuid().ToString('N'))
$setupPublishDir = Join-Path $tempPublishRoot 'setup-publish'

function Remove-PathIfExists {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LiteralPath
    )

    if (Test-Path -LiteralPath $LiteralPath) {
        Remove-Item -LiteralPath $LiteralPath -Recurse -Force
    }
}

function Invoke-Step {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Message,
        [Parameter(Mandatory = $true)]
        [scriptblock]$Action
    )

    Write-Host ''
    Write-Host "==> $Message"
    & $Action
}

function Invoke-ExternalCommand {
    param(
        [Parameter(Mandatory = $true)]
        [scriptblock]$Command
    )

    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Command failed with exit code $LASTEXITCODE."
    }
}

function Ensure-NodeModulesLink {
    param(
        [Parameter(Mandatory = $true)]
        [string]$LinkPath
    )

    if (Test-Path -LiteralPath $LinkPath) {
        return
    }

    New-Item -ItemType Junction -Path $LinkPath -Target $techStackNodeModules | Out-Null
}

function Clear-BuildOutputs {
    $paths = @(
        (Join-Path $repoRoot 'Scada.Api\bin'),
        (Join-Path $repoRoot 'Scada.Api\obj'),
        (Join-Path $repoRoot 'Scada.Launcher\bin'),
        (Join-Path $repoRoot 'Scada.Launcher\obj'),
        (Join-Path $repoRoot 'Scada.OpcUa\bin'),
        (Join-Path $repoRoot 'Scada.OpcUa\obj'),
        (Join-Path $repoRoot 'Scada.Setup\bin'),
        (Join-Path $repoRoot 'Scada.Setup\obj'),
        (Join-Path $repoRoot 'scada-web\dist'),
        (Join-Path $repoRoot 'Scada.Api\scada-api-5000.log'),
        $tempPublishRoot,
        $workspaceNodeModulesLink,
        $webNodeModulesLink
    )

    foreach ($path in $paths) {
        Remove-PathIfExists -LiteralPath $path
    }
}

if (-not (Test-Path -LiteralPath $techStackNodeModules)) {
    throw "Missing external node_modules: $techStackNodeModules"
}

$originalNodePath = $env:NODE_PATH
$originalPath = $env:PATH

try {
    $env:NODE_PATH = $techStackNodeModules
    $env:PATH = (Join-Path $techStackNodeModules '.bin') + ';' + $originalPath
    Ensure-NodeModulesLink -LinkPath $workspaceNodeModulesLink
    Ensure-NodeModulesLink -LinkPath $webNodeModulesLink

    Invoke-Step 'Build frontend into Scada.Api/wwwroot' {
        Push-Location $scadaWebDir
        try {
            Invoke-ExternalCommand { npm run build }
        }
        finally {
            Pop-Location
        }
    }

    Invoke-Step 'Publish Scada.Api payload' {
        Invoke-ExternalCommand { dotnet publish $apiProject -c Release -r win-x64 --self-contained false }
    }

    Invoke-Step 'Publish installer executable' {
        New-Item -ItemType Directory -Path $setupPublishDir -Force | Out-Null
        Invoke-ExternalCommand {
            dotnet publish $setupProject -c Release -r win-x64 --self-contained true `
                /p:PublishSingleFile=true `
                /p:IncludeNativeLibrariesForSelfExtract=true `
                -o $setupPublishDir
        }
    }

    Invoke-Step 'Copy installer to final output directory' {
        New-Item -ItemType Directory -Path $installerOutputRoot -Force | Out-Null

        $installerSource = Join-Path $setupPublishDir 'Scada.Setup.exe'
        if (-not (Test-Path -LiteralPath $installerSource)) {
            throw "Installer executable was not generated: $installerSource"
        }

        $timestamp = Get-Date -Format 'yyyy.MM.dd.HHmm'
        $installerFileName = "SCADA-Setup-$timestamp.exe"
        $installerTarget = Join-Path $installerOutputRoot $installerFileName
        Copy-Item -LiteralPath $installerSource -Destination $installerTarget -Force

        Write-Host ''
        Write-Host "Installer created: $installerTarget"
    }
}
finally {
    $env:NODE_PATH = $originalNodePath
    $env:PATH = $originalPath
    Clear-BuildOutputs
}
