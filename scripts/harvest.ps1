<#
.SYNOPSIS
    Harvest decisions, patterns, and topics from Copilot CLI sessions.

.DESCRIPTION
    Wrapper for engine/harvest.py. Auto-captures knowledge from your
    session history into ~/.grain/ wiki and decisions files.

    Run without --auto to preview (dry-run). Use --auto to write changes.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File scripts/harvest.ps1
    powershell -ExecutionPolicy Bypass -File scripts/harvest.ps1 --auto
    powershell -ExecutionPolicy Bypass -File scripts/harvest.ps1 --since 2026-04-08
    powershell -ExecutionPolicy Bypass -File scripts/harvest.ps1 --status
#>

$ErrorActionPreference = 'Stop'

$engineDir = Join-Path $PSScriptRoot '..' 'engine'
$harvestScript = Join-Path $engineDir 'harvest.py'

if (-not (Test-Path $harvestScript)) {
    Write-Host "ERROR: harvest.py not found at $harvestScript" -ForegroundColor Red
    exit 1
}

$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if (-not $pythonCmd) {
    Write-Host "ERROR: Python not found. Install Python 3.11+ to use harvest." -ForegroundColor Red
    exit 1
}

# Pass all arguments through to harvest.py
& python $harvestScript @args
