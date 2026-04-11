<#
.SYNOPSIS
    PowerShell wrapper for brain hygiene check and refactoring.

.DESCRIPTION
    Runs the Python-based hygiene checker or interactive refactoring tool
    against a knowledge base directory.

    Usage:
      powershell -File scripts/hygiene.ps1                       # check default path
      powershell -File scripts/hygiene.ps1 -Fix                  # auto-fix safe issues
      powershell -File scripts/hygiene.ps1 -Refactor             # interactive refactor
      powershell -File scripts/hygiene.ps1 -Json                 # JSON output
      powershell -File scripts/hygiene.ps1 -Path "C:\my\wiki"    # custom path

.NOTES
    Requires Python 3.11+ with engine/hygiene.py and engine/refactor.py.
#>

param(
    [string]$Path = (Join-Path $env:USERPROFILE ".grain"),
    [switch]$Fix,
    [switch]$Refactor,
    [switch]$Retrofit,
    [switch]$Json
)

$ErrorActionPreference = 'Stop'

# Resolve the engine directory relative to this script
$scriptRoot = Split-Path -Parent $PSScriptRoot
$engineDir = $scriptRoot

# Validate path exists
if (-not (Test-Path $Path)) {
    Write-Error "Path does not exist: $Path"
    exit 1
}

# Find Python
$python = $null
foreach ($candidate in @("python3", "python")) {
    try {
        $version = & $candidate --version 2>&1
        if ($version -match 'Python 3') {
            $python = $candidate
            break
        }
    } catch {
        # Try next candidate
    }
}

if (-not $python) {
    Write-Error "Python 3 not found. Install Python 3.11+ and ensure it's on PATH."
    exit 1
}

if ($Retrofit) {
    # Run the retrofit upgrade tool
    $retrofitScript = Join-Path $engineDir "engine" "retrofit.py"
    if (-not (Test-Path $retrofitScript)) {
        Write-Error "retrofit.py not found at: $retrofitScript"
        exit 1
    }

    Write-Host "Running brain retrofit..." -ForegroundColor Cyan
    & $python $retrofitScript $Path
    exit $LASTEXITCODE
}

if ($Refactor) {
    # Run the interactive refactoring tool
    $refactorScript = Join-Path $engineDir "engine" "refactor.py"
    if (-not (Test-Path $refactorScript)) {
        Write-Error "refactor.py not found at: $refactorScript"
        exit 1
    }

    Write-Host "Running brain refactoring..." -ForegroundColor Cyan
    & $python $refactorScript $Path
    exit $LASTEXITCODE
}

# Run the hygiene checker
$hygieneScript = Join-Path $engineDir "engine" "hygiene.py"
if (-not (Test-Path $hygieneScript)) {
    Write-Error "hygiene.py not found at: $hygieneScript"
    exit 1
}

$args_list = @($hygieneScript, $Path)
if ($Fix) {
    $args_list += "--fix"
}
if ($Json) {
    $args_list += "--json"
}

& $python @args_list
exit $LASTEXITCODE
