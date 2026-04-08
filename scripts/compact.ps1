# compact.ps1 - Compact brain.md
# Archives old "Recently Learned" entries, resets to lean state, updates timestamp

$ErrorActionPreference = 'Stop'
$grainDir = Join-Path $env:USERPROFILE '.grain'
$brainFile = Join-Path $grainDir 'brain.md'
$archiveFile = Join-Path $grainDir 'brain-archive.md'
$now = Get-Date
$nowIso = $now.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$archiveThresholdDays = 14

if (-not (Test-Path $brainFile)) {
    Write-Host "ERROR: brain.md not found at $brainFile"
    exit 1
}

$content = Get-Content $brainFile -Raw
$lines = Get-Content $brainFile

# --- 1. Update last_refreshed timestamp ---
$content = $content -replace 'Last refreshed:\s*\S+', "Last refreshed: $nowIso"

# --- 2. Archive old "Recently Learned" entries ---
$inRecentlyLearned = $false
$recentlyLearnedStart = -1
$recentlyLearnedEnd = -1
$nextSectionPattern = '^## '

for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^## Recently Learned') {
        $inRecentlyLearned = $true
        $recentlyLearnedStart = $i
        continue
    }
    if ($inRecentlyLearned -and $lines[$i] -match $nextSectionPattern) {
        $recentlyLearnedEnd = $i
        break
    }
}

if ($recentlyLearnedStart -eq -1) {
    Write-Host "No 'Recently Learned' section found - skipping archive step."
} else {
    if ($recentlyLearnedEnd -eq -1) { $recentlyLearnedEnd = $lines.Count }

    $sectionLines = $lines[($recentlyLearnedStart + 1)..($recentlyLearnedEnd - 1)]
    $entriesToKeep = @()
    $entriesToArchive = @()

    $currentEntry = @()
    $entryDate = $null

    foreach ($line in $sectionLines) {
        if ($line -match '^\s*\d+\.\s' -or $line -match '^\s*[-*]\s') {
            if ($currentEntry.Count -gt 0) {
                $entryText = $currentEntry -join "`n"
                if ($entryDate -and (($now - $entryDate).Days -gt $archiveThresholdDays)) {
                    $entriesToArchive += $entryText
                } else {
                    $entriesToKeep += $entryText
                }
            }
            $currentEntry = @($line)
            $entryDate = $null
            if ($line -match '\b(\d{4}-\d{2}-\d{2})\b') {
                try { $entryDate = [DateTime]::Parse($Matches[1]) } catch {}
            }
        } else {
            $currentEntry += $line
        }
    }
    # Flush last entry
    if ($currentEntry.Count -gt 0) {
        $entryText = $currentEntry -join "`n"
        if ($entryDate -and (($now - $entryDate).Days -gt $archiveThresholdDays)) {
            $entriesToArchive += $entryText
        } else {
            $entriesToKeep += $entryText
        }
    }

    if ($entriesToArchive.Count -gt 0) {
        $archiveHeader = ""
        if (-not (Test-Path $archiveFile)) {
            $archiveHeader = "# Brain Archive`n`nArchived entries from brain.md. Moved by compact.ps1.`n`n---`n`n"
        }
        $archiveBlock = "## Archived $nowIso`n`n" + ($entriesToArchive -join "`n`n") + "`n`n"
        Add-Content -Path $archiveFile -Value ($archiveHeader + $archiveBlock) -Encoding UTF8
        Write-Host "Archived $($entriesToArchive.Count) entries to brain-archive.md"
    } else {
        Write-Host "No entries older than $archiveThresholdDays days to archive."
    }

    $newSection = $lines[0..$recentlyLearnedStart]
    if ($entriesToKeep.Count -gt 0) {
        $newSection += ""
        $newSection += $entriesToKeep
    } else {
        $newSection += ""
        $newSection += "(No recent entries - all archived)"
    }
    $newSection += ""
    if ($recentlyLearnedEnd -lt $lines.Count) {
        $newSection += $lines[$recentlyLearnedEnd..($lines.Count - 1)]
    }

    $content = $newSection -join "`n"
}

# --- 3. Try to refresh Active Work from session_store if sqlite3 available ---
$sqlite3 = Get-Command sqlite3 -ErrorAction SilentlyContinue
if ($sqlite3) {
    $sessionDb = Join-Path $env:USERPROFILE '.copilot' 'session-store' 'session_store.db'
    if (Test-Path $sessionDb) {
        Write-Host "Querying session_store for active work summary..."
        try {
            $recentSessions = & sqlite3 $sessionDb "SELECT summary FROM sessions WHERE summary IS NOT NULL ORDER BY updated_at DESC LIMIT 10;" 2>$null
            if ($recentSessions) {
                Write-Host "Found $($recentSessions.Count) recent sessions in store."
            }
        } catch {
            Write-Host "Could not query session_store: $_"
        }
    }
} else {
    Write-Host "sqlite3 not found - skipping session_store refresh."
}

# --- 4. Write compacted brain.md ---
$content = $content -replace 'Last refreshed:\s*\S+', "Last refreshed: $nowIso"
Set-Content -Path $brainFile -Value $content -Encoding UTF8 -NoNewline
Write-Host ""
Write-Host "brain.md compacted. Last refreshed: $nowIso"
Write-Host "Done."
