<#
.SYNOPSIS
    Register Windows Task Scheduler tasks for wiki-recall maintenance.

.DESCRIPTION
    Creates three scheduled tasks:
    1. "WikiRecall Maintenance" -- runs maintenance.ps1 at chosen frequency
    2. "WikiRecall Backup" -- runs backup.ps1 local, offset by 30 min
    3. "WikiRecall Nightly" -- runs maintenance.ps1 daily at 11 PM

    No admin privileges required -- tasks run as the current user.

    Usage:
      powershell -ExecutionPolicy Bypass -File scripts/setup-scheduler.ps1 -Frequency hourly
      powershell -ExecutionPolicy Bypass -File scripts/setup-scheduler.ps1 -Uninstall

.PARAMETER Frequency
    How often to run maintenance: "hourly", "every4hours", or "daily"

.PARAMETER Uninstall
    Remove all wiki-recall scheduled tasks

.NOTES
    All tasks run hidden with AllowStartIfOnBatteries and StartWhenAvailable.
#>
param(
    [ValidateSet("hourly", "every4hours", "daily")]
    [string]$Frequency = "hourly",

    [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'

$taskPrefix = 'WikiRecall'
$taskNames = @(
    "$taskPrefix Maintenance",
    "$taskPrefix Backup",
    "$taskPrefix Nightly"
)

$scriptsDir = $PSScriptRoot
$maintenanceScript = Join-Path $scriptsDir 'maintenance.ps1'
$backupScript = Join-Path $scriptsDir 'backup.ps1'

# --- Uninstall ---
if ($Uninstall) {
    Write-Host "Removing wiki-recall scheduled tasks..." -ForegroundColor Yellow
    foreach ($name in $taskNames) {
        $existing = Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
        if ($existing) {
            Unregister-ScheduledTask -TaskName $name -Confirm:$false
            Write-Host "  Removed: $name" -ForegroundColor Green
        } else {
            Write-Host "  Not found: $name" -ForegroundColor DarkGray
        }
    }
    Write-Host "Done." -ForegroundColor Green
    exit 0
}

# --- Validate scripts exist ---
if (-not (Test-Path $maintenanceScript)) {
    Write-Host "ERROR: maintenance.ps1 not found at $maintenanceScript" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $backupScript)) {
    Write-Host "ERROR: backup.ps1 not found at $backupScript" -ForegroundColor Red
    exit 1
}

# --- Common task settings ---
$taskSettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -Hidden

$pwshPath = (Get-Command powershell -ErrorAction SilentlyContinue).Source
if (-not $pwshPath) { $pwshPath = 'powershell.exe' }

# --- Task 1: Maintenance ---
Write-Host "Setting up wiki-recall scheduled tasks (frequency: $Frequency)..." -ForegroundColor Cyan

$maintenanceAction = New-ScheduledTaskAction `
    -Execute $pwshPath `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$maintenanceScript`""

$maintenanceTrigger = switch ($Frequency) {
    'hourly' {
        New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration ([System.TimeSpan]::MaxValue)
    }
    'every4hours' {
        New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Hours 4) -RepetitionDuration ([System.TimeSpan]::MaxValue)
    }
    'daily' {
        New-ScheduledTaskTrigger -Daily -At '08:00'
    }
}

$existing = Get-ScheduledTask -TaskName "$taskPrefix Maintenance" -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName "$taskPrefix Maintenance" -Confirm:$false
}
Register-ScheduledTask `
    -TaskName "$taskPrefix Maintenance" `
    -Action $maintenanceAction `
    -Trigger $maintenanceTrigger `
    -Settings $taskSettings `
    -Description "wiki-recall: run maintenance pipeline ($Frequency)" | Out-Null
Write-Host "  Registered: $taskPrefix Maintenance ($Frequency)" -ForegroundColor Green

# --- Task 2: Backup (offset 30 min) ---
$backupAction = New-ScheduledTaskAction `
    -Execute $pwshPath `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$backupScript`" -Layer local"

$backupTrigger = switch ($Frequency) {
    'hourly' {
        New-ScheduledTaskTrigger -Once -At ((Get-Date).Date.AddMinutes(30)) -RepetitionInterval (New-TimeSpan -Hours 1) -RepetitionDuration ([System.TimeSpan]::MaxValue)
    }
    'every4hours' {
        New-ScheduledTaskTrigger -Once -At ((Get-Date).Date.AddMinutes(30)) -RepetitionInterval (New-TimeSpan -Hours 4) -RepetitionDuration ([System.TimeSpan]::MaxValue)
    }
    'daily' {
        New-ScheduledTaskTrigger -Daily -At '08:30'
    }
}

$existing = Get-ScheduledTask -TaskName "$taskPrefix Backup" -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName "$taskPrefix Backup" -Confirm:$false
}
Register-ScheduledTask `
    -TaskName "$taskPrefix Backup" `
    -Action $backupAction `
    -Trigger $backupTrigger `
    -Settings $taskSettings `
    -Description "wiki-recall: backup core files ($Frequency, offset 30min)" | Out-Null
Write-Host "  Registered: $taskPrefix Backup ($Frequency + 30min offset)" -ForegroundColor Green

# --- Task 3: Nightly (11 PM, WakeToRun) ---
$nightlyAction = New-ScheduledTaskAction `
    -Execute $pwshPath `
    -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$maintenanceScript`""

$nightlyTrigger = New-ScheduledTaskTrigger -Daily -At '23:00'

$nightlySettings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries `
    -DontStopIfGoingOnBatteries `
    -StartWhenAvailable `
    -WakeToRun `
    -Hidden

$existing = Get-ScheduledTask -TaskName "$taskPrefix Nightly" -ErrorAction SilentlyContinue
if ($existing) {
    Unregister-ScheduledTask -TaskName "$taskPrefix Nightly" -Confirm:$false
}
Register-ScheduledTask `
    -TaskName "$taskPrefix Nightly" `
    -Action $nightlyAction `
    -Trigger $nightlyTrigger `
    -Settings $nightlySettings `
    -Description "wiki-recall: nightly full maintenance (11 PM, wake-to-run)" | Out-Null
Write-Host "  Registered: $taskPrefix Nightly (daily at 11 PM, WakeToRun)" -ForegroundColor Green

# --- Summary ---
Write-Host ""
Write-Host "All tasks registered. View with:" -ForegroundColor Cyan
Write-Host "  Get-ScheduledTask | Where-Object { `$_.TaskName -like 'WikiRecall*' }" -ForegroundColor DarkGray
Write-Host ""
Write-Host "To remove all tasks:" -ForegroundColor Cyan
Write-Host "  powershell -File scripts/setup-scheduler.ps1 -Uninstall" -ForegroundColor DarkGray
Write-Host ""
