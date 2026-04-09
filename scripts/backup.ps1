# backup.ps1 - Backup ~/.grain/ before any write operation
# Creates a timestamped copy of key files in ~/.grain/.backups/
# Keeps last 10 backups, auto-prunes older ones.

$ErrorActionPreference = 'SilentlyContinue'
$grainDir = Join-Path $env:USERPROFILE '.grain'
$backupRoot = Join-Path $grainDir '.backups'
$maxBackups = 10

if (-not (Test-Path $grainDir)) {
    Write-Host "ERROR: ~/.grain/ not found at $grainDir"
    exit 1
}

# Create backup directory
$timestamp = (Get-Date).ToUniversalTime().ToString('yyyyMMdd-HHmmss')
$backupDir = Join-Path $backupRoot $timestamp

New-Item -ItemType Directory -Path $backupDir -Force | Out-Null

# Files to back up (key knowledge files only, not engine/chromadb)
$filesToBackup = @(
    'brain.md',
    'actions.md',
    'decisions.md'
)

$backedUp = 0

# Back up individual files
foreach ($f in $filesToBackup) {
    $src = Join-Path $grainDir $f
    if (Test-Path $src) {
        Copy-Item -Path $src -Destination (Join-Path $backupDir $f) -Force
        $backedUp++
    }
}

# Back up wiki directory
$wikiSrc = Join-Path $grainDir 'wiki'
if (Test-Path $wikiSrc) {
    $wikiDst = Join-Path $backupDir 'wiki'
    Copy-Item -Path $wikiSrc -Destination $wikiDst -Recurse -Force
    $wikiCount = (Get-ChildItem -Path $wikiDst -Recurse -Filter '*.md').Count
    $backedUp += $wikiCount
}

# Back up domains directory
$domainsSrc = Join-Path $grainDir 'domains'
if (Test-Path $domainsSrc) {
    $domainsDst = Join-Path $backupDir 'domains'
    Copy-Item -Path $domainsSrc -Destination $domainsDst -Recurse -Force
    $domainCount = (Get-ChildItem -Path $domainsDst -Recurse -Filter '*.md').Count
    $backedUp += $domainCount
}

Write-Host "Backup: $backupDir ($backedUp files)"

# --- Prune old backups ---
$allBackups = Get-ChildItem -Path $backupRoot -Directory | Sort-Object Name -Descending
if ($allBackups.Count -gt $maxBackups) {
    $toDelete = $allBackups | Select-Object -Skip $maxBackups
    foreach ($old in $toDelete) {
        Remove-Item -Path $old.FullName -Recurse -Force
    }
    $pruned = $toDelete.Count
    if ($pruned -gt 0) {
        Write-Host "Pruned $pruned old backup(s)"
    }
}
