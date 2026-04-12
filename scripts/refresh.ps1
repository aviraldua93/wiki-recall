<#
.SYNOPSIS
    Refreshes ~/.grain/brain.md by mining Copilot CLI session_store.

.DESCRIPTION
    Queries the session_store SQLite database to extract:
    - Active repos and branches (last 3 days)
    - Most-edited files (hot files)
    - Recent session summaries
    Rewrites the "Active Work" section of brain.md.

    Run this periodically or at session start:
      powershell -ExecutionPolicy Bypass -File ~/.grain/scripts/refresh.ps1

.NOTES
    LOCAL ONLY. Never push brain.md to any repo.
#>

$brainPath = Join-Path $HOME ".grain\brain.md"
$dbPath = Join-Path $HOME ".copilot\session-store.db"

if (-not (Test-Path $dbPath)) {
    Write-Host "Session store not found at $dbPath" -ForegroundColor Red
    exit 1
}

# Check for sqlite3
$sqlite = Get-Command sqlite3 -ErrorAction SilentlyContinue
if (-not $sqlite) {
    $candidates = @(
        "C:\ProgramData\chocolatey\bin\sqlite3.exe",
        "$HOME\scoop\shims\sqlite3.exe",
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages\*\sqlite3.exe"
    )
    foreach ($c in $candidates) {
        $found = Get-Item $c -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { $sqlite = $found.FullName; break }
    }
}

if (-not $sqlite) {
    Write-Host "sqlite3 not found. Install via: winget install SQLite.SQLite" -ForegroundColor Yellow
    Write-Host "Falling back to static brain.md (no refresh)" -ForegroundColor DarkGray
    exit 0
}

function Query-SessionStore {
    param([string]$sql)
    $result = & $sqlite -header -separator "|" $dbPath $sql 2>$null
    return $result
}

Write-Host "Refreshing brain.md from session_store..." -ForegroundColor Cyan

# 1. Active repos (last 3 days)
$repoQuery = @"
SELECT repository, branch, COUNT(*) as sessions, MAX(created_at) as last_active
FROM sessions 
WHERE created_at > date('now', '-3 days') AND repository IS NOT NULL
GROUP BY repository ORDER BY last_active DESC LIMIT 10;
"@
$repos = Query-SessionStore $repoQuery

# 2. Hot files (most edited, last 3 days)
$fileQuery = @"
SELECT sf.file_path, COUNT(DISTINCT sf.session_id) as sessions
FROM session_files sf JOIN sessions s ON sf.session_id = s.id
WHERE sf.tool_name = 'edit' AND s.created_at > date('now', '-3 days')
GROUP BY sf.file_path ORDER BY sessions DESC LIMIT 15;
"@
$files = Query-SessionStore $fileQuery

# 3. Recent checkpoints
$cpQuery = @"
SELECT c.title, c.overview, s.repository
FROM checkpoints c JOIN sessions s ON c.session_id = s.id
WHERE s.created_at > date('now', '-3 days')
ORDER BY s.created_at DESC LIMIT 5;
"@
$checkpoints = Query-SessionStore $cpQuery

# Build the Active Work section
$activeWork = @()
$activeWork += "## Active Work (auto-refreshed $(Get-Date -Format 'yyyy-MM-dd HH:mm'))"
$activeWork += ""

if ($repos) {
    foreach ($line in ($repos | Select-Object -Skip 1)) {
        $parts = $line -split '\|'
        if ($parts.Count -ge 4) {
            $repo = $parts[0].Trim()
            $branch = $parts[1].Trim()
            $count = $parts[2].Trim()
            $last = $parts[3].Trim()
            $activeWork += "- **$repo** ($branch) - $count sessions, last: $last"
        }
    }
}

$activeWork += ""
$activeWork += "### Hot Files"
if ($files) {
    foreach ($line in ($files | Select-Object -Skip 1)) {
        $parts = $line -split '\|'
        if ($parts.Count -ge 2) {
            $file = $parts[0].Trim()
            $count = $parts[1].Trim()
            $short = $file -replace [regex]::Escape($HOME), '~'
            $activeWork += "- $short ($count sessions)"
        }
    }
}

$activeWork += ""
$activeWork += "### Recent Milestones"
if ($checkpoints) {
    foreach ($line in ($checkpoints | Select-Object -Skip 1)) {
        $parts = $line -split '\|'
        if ($parts.Count -ge 2) {
            $title = $parts[0].Trim()
            $activeWork += "- $title"
        }
    }
}

# Read existing brain.md
if (Test-Path $brainPath) {
    $brain = Get-Content $brainPath -Raw
    
    if ($brain -match '(?s)(## Active Work.+?)(## Decisions)') {
        $newSection = ($activeWork -join "`n") + "`n`n"
        $brain = $brain -replace '(?s)(## Active Work.+?)(## Decisions)', "$newSection`$2"
        Set-Content -Path $brainPath -Value $brain -Encoding UTF8
        Write-Host "brain.md refreshed!" -ForegroundColor Green
    } else {
        Write-Host "Could not find Active Work section to replace" -ForegroundColor Yellow
    }
} else {
    Write-Host "brain.md not found at $brainPath" -ForegroundColor Red
}

Write-Host "Done. $(($repos | Measure-Object).Count - 1) repos, $(($files | Measure-Object).Count - 1) hot files tracked." -ForegroundColor DarkGray
