<#
.SYNOPSIS
    Backup ~/.grain/ core files (excludes rebuildable data).

.DESCRIPTION
    Local backup strategy for wiki-recall knowledge base.
    Copies core files to ~/wiki-recall-backup/ with date-stamped folders.
    Excludes rebuildable directories: chromadb, __pycache__, node_modules, .obsidian

    Usage:
      powershell -ExecutionPolicy Bypass -File scripts/backup.ps1 -Layer status
      powershell -ExecutionPolicy Bypass -File scripts/backup.ps1 -Layer local
      powershell -ExecutionPolicy Bypass -File scripts/backup.ps1 -Layer all

.PARAMETER Layer
    Which backup operation: "local", "all", or "status"

.NOTES
    All data stays local. No cloud or corporate dependencies.
#>
param(
    [ValidateSet("local", "all", "status")]
    [string]$Layer = "status"
)

$ErrorActionPreference = 'Stop'

$GrainPath = Join-Path $env:USERPROFILE '.grain'
$BackupBase = Join-Path $env:USERPROFILE 'wiki-recall-backup'
$Timestamp = (Get-Date).ToString('yyyy-MM-dd')

# Exclude rebuildable dirs
$ExcludeDirs = @('chromadb', '.mining', '.verification', '.obsidian', 'node_modules', '__pycache__', '.git')

function Get-CoreFiles {
    if (-not (Test-Path $GrainPath)) {
        Write-Host "  ~/.grain/ not found -- nothing to back up." -ForegroundColor Yellow
        return @()
    }
    Get-ChildItem $GrainPath -Recurse -File | Where-Object {
        $dominated = $false
        foreach ($ex in $ExcludeDirs) {
            if ($_.FullName -match [regex]::Escape($ex)) { $dominated = $true; break }
        }
        -not $dominated
    }
}

function Show-Status {
    $coreFiles = Get-CoreFiles
    $coreSize = if ($coreFiles.Count -gt 0) {
        [math]::Round(($coreFiles | Measure-Object -Property Length -Sum).Sum / 1KB, 1)
    } else { 0 }

    Write-Host ""
    Write-Host "  wiki-recall Backup Status" -ForegroundColor Cyan
    Write-Host "  =========================" -ForegroundColor Cyan
    Write-Host "  Source: $GrainPath" -ForegroundColor White
    Write-Host "  Core files: $($coreFiles.Count) ($coreSize KB)" -ForegroundColor White

    if (Test-Path $BackupBase) {
        $lastBackup = Get-ChildItem $BackupBase -Directory -ErrorAction SilentlyContinue |
            Sort-Object Name | Select-Object -Last 1
        if ($lastBackup) {
            $age = ((Get-Date) - $lastBackup.LastWriteTime).Days
            $fileCount = (Get-ChildItem $lastBackup.FullName -Recurse -File -ErrorAction SilentlyContinue).Count
            $color = if ($age -le 1) { 'Green' } elseif ($age -le 7) { 'Yellow' } else { 'Red' }
            Write-Host "  Local backup: last $age days ago ($($lastBackup.Name), $fileCount files)" -ForegroundColor $color
        } else {
            Write-Host "  Local backup: no backups yet" -ForegroundColor Red
        }
    } else {
        Write-Host "  Local backup: not configured (run: backup.ps1 -Layer local)" -ForegroundColor DarkGray
    }
    Write-Host ""
}

function Backup-Local {
    Write-Host "  Backing up to ~/wiki-recall-backup/ ..." -ForegroundColor Cyan
    $dest = Join-Path $BackupBase $Timestamp
    New-Item -ItemType Directory -Path $dest -Force | Out-Null

    $coreFiles = Get-CoreFiles
    if ($coreFiles.Count -eq 0) {
        Write-Host "  No files to back up." -ForegroundColor Yellow
        return
    }

    foreach ($f in $coreFiles) {
        $rel = $f.FullName.Substring($GrainPath.Length + 1)
        $target = Join-Path $dest $rel
        $targetDir = Split-Path $target -Parent
        if (-not (Test-Path $targetDir)) {
            New-Item -ItemType Directory -Path $targetDir -Force | Out-Null
        }
        Copy-Item $f.FullName $target
    }

    # Keep last 7 backups, delete older
    $backups = Get-ChildItem $BackupBase -Directory | Sort-Object Name
    if ($backups.Count -gt 7) {
        $backups | Select-Object -First ($backups.Count - 7) | ForEach-Object {
            Remove-Item $_.FullName -Recurse -Force
        }
        Write-Host "  Pruned to last 7 backups." -ForegroundColor DarkGray
    }

    Write-Host "  Done: $($coreFiles.Count) files -> $dest" -ForegroundColor Green
}

# --- Main ---
switch ($Layer) {
    'status' { Show-Status }
    'local'  { Backup-Local; Show-Status }
    'all'    { Backup-Local; Show-Status }
}
