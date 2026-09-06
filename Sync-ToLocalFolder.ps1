$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$sourceRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$targetRoot = 'C:\Users\syxxz\OneDrive\SCADA\Scada_Codex'

$resolvedSourceRoot = [System.IO.Path]::GetFullPath($sourceRoot).TrimEnd('\')
$resolvedTargetRoot = [System.IO.Path]::GetFullPath($targetRoot).TrimEnd('\')
if ([System.StringComparer]::OrdinalIgnoreCase.Equals($resolvedSourceRoot, $resolvedTargetRoot)) {
    Write-Host "Project is already located at the target folder: $resolvedSourceRoot"
    exit 0
}

if (-not (Test-Path -LiteralPath $targetRoot)) {
    throw "Target folder does not exist: $targetRoot"
}

$robocopyArgs = @(
    $sourceRoot
    $targetRoot
    '/MIR'
    '/XD', '.git', '.vs', 'bin', 'obj', 'node_modules', 'runlogs'
    '/XF', '*.user', '*.suo'
    '/R:2'
    '/W:1'
    '/NFL'
    '/NDL'
    '/NP'
)

Write-Host "Syncing project to local folder..."
Write-Host "Source: $sourceRoot"
Write-Host "Target: $targetRoot"

& robocopy @robocopyArgs
$exitCode = $LASTEXITCODE

if ($exitCode -ge 8) {
    throw "Robocopy failed with exit code $exitCode."
}

Write-Host "Local folder sync completed."
