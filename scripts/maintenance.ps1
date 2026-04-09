<#
.SYNOPSIS
    Master maintenance script — runs all wiki-recall housekeeping in sequence.

.DESCRIPTION
    Executes the full maintenance pipeline:
    1. Harvest new sessions (refresh.ps1 mines session_store)
    2. Backup brain + wiki (backup.ps1 local)
    3. Run lint (lint.ps1 wiki health check)
    4. Compact brain.md if >80 lines (compact.ps1)
    5. Log results to ~/.grain/logs/maintenance-YYYY-MM-DD.log
    6. Prune logs older than 30 days

    Each step uses try/catch — one failure doesn't stop the rest.

    Usage:
      powershell -ExecutionPolicy Bypass -File scripts/maintenance.ps1
      powershell -ExecutionPolicy Bypass -File scripts/maintenance.ps1 -Verbose
      powershell -ExecutionPolicy Bypass -File scripts/maintenance.ps1 -WhatIf

.NOTES
    All data stays local in ~/.grain/. Nothing is pushed anywhere.
#>

[CmdletBinding(SupportsShouldProcess)]
param()

$ErrorActionPreference = 'Continue'

$grainDir = Join-Path $env:USERPROFILE '.grain'
$scriptsDir = $PSScriptRoot
$logDir = Join-Path $grainDir 'logs'
$today = (Get-Date).ToString('yyyy-MM-dd')
$logFile = Join-Path $logDir "maintenance-$today.log"

$stepResults = @()
$hasFailure = $false

# --- Logging helper ---
function Write-Log {
    param([string]$Message, [string]$Level = 'INFO')
    $timestamp = (Get-Date).ToString('HH:mm:ss')
    $line = "[$timestamp] [$Level] $Message"
    Write-Host $line -ForegroundColor $(switch ($Level) {
        'ERROR' { 'Red' }
        'WARN'  { 'Yellow' }
        'OK'    { 'Green' }
        default { 'White' }
    })
    if (-not $WhatIfPreference) {
        Add-Content -Path $logFile -Value $line -Encoding UTF8 -ErrorAction SilentlyContinue
    }
}

# --- Ensure log directory ---
if (-not (Test-Path $logDir)) {
    if ($PSCmdlet.ShouldProcess($logDir, 'Create log directory')) {
        New-Item -ItemType Directory -Path $logDir -Force | Out-Null
    }
}

Write-Log "=== wiki-recall maintenance started ==="
Write-Verbose "Scripts directory: $scriptsDir"
Write-Verbose "Log file: $logFile"

# --- Step 1: Harvest new sessions ---
Write-Log "Step 1/4: Harvesting sessions (refresh.ps1)..."
try {
    if ($PSCmdlet.ShouldProcess('session_store', 'Refresh brain.md from sessions')) {
        $refreshScript = Join-Path $scriptsDir 'refresh.ps1'
        if (Test-Path $refreshScript) {
            & powershell -ExecutionPolicy Bypass -File $refreshScript 2>&1 | ForEach-Object {
                Write-Verbose "  refresh: $_"
            }
            Write-Log "Step 1: PASS — sessions harvested" 'OK'
            $stepResults += @{ Step = 'refresh'; Status = 'PASS' }
        } else {
            Write-Log "Step 1: SKIP — refresh.ps1 not found" 'WARN'
            $stepResults += @{ Step = 'refresh'; Status = 'SKIP' }
        }
    }
} catch {
    Write-Log "Step 1: FAIL — $($_.Exception.Message)" 'ERROR'
    $stepResults += @{ Step = 'refresh'; Status = 'FAIL'; Error = $_.Exception.Message }
    $hasFailure = $true
}

# --- Step 2: Backup ---
Write-Log "Step 2/4: Backing up (backup.ps1 local)..."
try {
    if ($PSCmdlet.ShouldProcess('~/.grain/', 'Backup core files')) {
        $backupScript = Join-Path $scriptsDir 'backup.ps1'
        if (Test-Path $backupScript) {
            & powershell -ExecutionPolicy Bypass -File $backupScript -Layer local 2>&1 | ForEach-Object {
                Write-Verbose "  backup: $_"
            }
            Write-Log "Step 2: PASS — backup completed" 'OK'
            $stepResults += @{ Step = 'backup'; Status = 'PASS' }
        } else {
            Write-Log "Step 2: SKIP — backup.ps1 not found" 'WARN'
            $stepResults += @{ Step = 'backup'; Status = 'SKIP' }
        }
    }
} catch {
    Write-Log "Step 2: FAIL — $($_.Exception.Message)" 'ERROR'
    $stepResults += @{ Step = 'backup'; Status = 'FAIL'; Error = $_.Exception.Message }
    $hasFailure = $true
}

# --- Step 3: Lint ---
Write-Log "Step 3/4: Running lint (lint.ps1)..."
try {
    if ($PSCmdlet.ShouldProcess('wiki', 'Run wiki health check')) {
        $lintScript = Join-Path $scriptsDir 'lint.ps1'
        if (Test-Path $lintScript) {
            & powershell -ExecutionPolicy Bypass -File $lintScript 2>&1 | ForEach-Object {
                Write-Verbose "  lint: $_"
            }
            Write-Log "Step 3: PASS — lint completed" 'OK'
            $stepResults += @{ Step = 'lint'; Status = 'PASS' }
        } else {
            Write-Log "Step 3: SKIP — lint.ps1 not found" 'WARN'
            $stepResults += @{ Step = 'lint'; Status = 'SKIP' }
        }
    }
} catch {
    Write-Log "Step 3: FAIL — $($_.Exception.Message)" 'ERROR'
    $stepResults += @{ Step = 'lint'; Status = 'FAIL'; Error = $_.Exception.Message }
    $hasFailure = $true
}

# --- Step 4: Compact brain.md if >80 lines ---
Write-Log "Step 4/4: Checking brain.md size..."
try {
    $brainFile = Join-Path $grainDir 'brain.md'
    if (Test-Path $brainFile) {
        $lineCount = (Get-Content $brainFile).Count
        Write-Verbose "brain.md has $lineCount lines"
        if ($lineCount -gt 80) {
            if ($PSCmdlet.ShouldProcess("brain.md ($lineCount lines)", 'Compact')) {
                $compactScript = Join-Path $scriptsDir 'compact.ps1'
                if (Test-Path $compactScript) {
                    & powershell -ExecutionPolicy Bypass -File $compactScript 2>&1 | ForEach-Object {
                        Write-Verbose "  compact: $_"
                    }
                    Write-Log "Step 4: PASS — brain.md compacted ($lineCount -> $(( Get-Content $brainFile).Count) lines)" 'OK'
                } else {
                    Write-Log "Step 4: SKIP — compact.ps1 not found" 'WARN'
                }
            }
            $stepResults += @{ Step = 'compact'; Status = 'PASS' }
        } else {
            Write-Log "Step 4: SKIP — brain.md is $lineCount lines (threshold: 80)" 'INFO'
            $stepResults += @{ Step = 'compact'; Status = 'SKIP' }
        }
    } else {
        Write-Log "Step 4: SKIP — brain.md not found" 'WARN'
        $stepResults += @{ Step = 'compact'; Status = 'SKIP' }
    }
} catch {
    Write-Log "Step 4: FAIL — $($_.Exception.Message)" 'ERROR'
    $stepResults += @{ Step = 'compact'; Status = 'FAIL'; Error = $_.Exception.Message }
    $hasFailure = $true
}

# --- Step 5: Prune old logs ---
Write-Log "Pruning logs older than 30 days..."
try {
    if (Test-Path $logDir) {
        $cutoff = (Get-Date).AddDays(-30)
        $oldLogs = Get-ChildItem -Path $logDir -Filter 'maintenance-*.log' |
            Where-Object { $_.LastWriteTime -lt $cutoff }
        if ($oldLogs.Count -gt 0) {
            if ($PSCmdlet.ShouldProcess("$($oldLogs.Count) old log files", 'Delete')) {
                $oldLogs | Remove-Item -Force
                Write-Log "Pruned $($oldLogs.Count) old log files" 'OK'
            }
        } else {
            Write-Verbose "No old logs to prune"
        }
    }
} catch {
    Write-Log "Log pruning failed: $($_.Exception.Message)" 'WARN'
}

# --- Summary ---
Write-Log "=== Maintenance complete ==="
$passCount = ($stepResults | Where-Object { $_.Status -eq 'PASS' }).Count
$failCount = ($stepResults | Where-Object { $_.Status -eq 'FAIL' }).Count
$skipCount = ($stepResults | Where-Object { $_.Status -eq 'SKIP' }).Count
Write-Log "Results: $passCount passed, $failCount failed, $skipCount skipped"

if ($hasFailure) {
    Write-Log "Exit code: 1 (failures detected)" 'ERROR'
    exit 1
} else {
    Write-Log "Exit code: 0 (all OK)" 'OK'
    exit 0
}
