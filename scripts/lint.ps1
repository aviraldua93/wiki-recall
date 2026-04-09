# lint.ps1 - Wiki Health Check
# Checks: orphans, missing refs, stale pages, frontmatter, brain age, decisions size, index coverage

$ErrorActionPreference = 'SilentlyContinue'
$grainDir = Join-Path $env:USERPROFILE '.grain'
$wikiDir = Join-Path $grainDir 'wiki'
$indexFile = Join-Path $wikiDir 'index.md'
$brainFile = Join-Path $grainDir 'brain.md'
$decisionsFile = Join-Path $grainDir 'decisions.md'

# --- Collect all wiki .md pages (excluding index.md and log.md) ---
$allPages = Get-ChildItem -Path $wikiDir -Recurse -Filter '*.md' |
    Where-Object { $_.Name -ne 'index.md' -and $_.Name -ne 'log.md' } |
    ForEach-Object {
        [PSCustomObject]@{
            Name     = $_.BaseName
            FullPath = $_.FullName
        }
    }
$pageNames = $allPages | ForEach-Object { $_.Name }
$totalPages = $allPages.Count

# --- Read index.md content ---
$indexContent = if (Test-Path $indexFile) { Get-Content $indexFile -Raw } else { '' }

# --- 1. Index coverage: find pages listed as [[name]] in index.md ---
$indexLinks = [regex]::Matches($indexContent, '\[\[([^\]]+)\]\]') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique
$indexedSet = @{}
foreach ($l in $indexLinks) { $indexedSet[$l] = $true }

# Orphan pages: exist as files but NOT referenced in index.md
$orphans = @()
foreach ($p in $allPages) {
    if (-not $indexedSet.ContainsKey($p.Name)) {
        $orphans += $p.Name
    }
}

# Index coverage count
$coveredCount = 0
foreach ($p in $pageNames) {
    if ($indexedSet.ContainsKey($p)) { $coveredCount++ }
}

# --- 2. Missing refs: referenced in [[wikilinks]] across ALL wiki files but no .md file exists ---
$allWikiContent = Get-ChildItem -Path $wikiDir -Recurse -Filter '*.md' |
    ForEach-Object { Get-Content $_.FullName -Raw }
$allWikiText = $allWikiContent -join "`n"

$allWikiLinks = [regex]::Matches($allWikiText, '\[\[([^\]]+)\]\]') |
    ForEach-Object { $_.Groups[1].Value } |
    Sort-Object -Unique

$pageNameSet = @{}
foreach ($p in $pageNames) { $pageNameSet[$p] = $true }
$pageNameSet['index'] = $true

$missingRefs = @()
foreach ($link in $allWikiLinks) {
    if (-not $pageNameSet.ContainsKey($link)) {
        $missingRefs += $link
    }
}

# --- 3. Stale pages: frontmatter `last_verified:` or `updated:` older than threshold ---
$staleDaysVerified = 60    # last_verified threshold (Feature 2: staleness detection)
$staleDaysUpdated = 30     # updated threshold (legacy)
$now = Get-Date
$stalePages = @()
$unverifiedPages = @()
foreach ($p in $allPages) {
    $content = Get-Content $p.FullPath -Raw
    $hasLastVerified = $false

    # Check last_verified (preferred — set by harvest.py)
    if ($content -match '(?m)^last_verified:\s*(.+)$') {
        $hasLastVerified = $true
        $dateStr = $Matches[1].Trim().Trim('"').Trim("'")
        try {
            $verifiedDate = [DateTime]::Parse($dateStr)
            $age = ($now - $verifiedDate).Days
            if ($age -gt $staleDaysVerified) {
                $stalePages += "$($p.Name) (${age}d unverified)"
            }
        } catch {
            # unparseable date — flag as stale
            $stalePages += "$($p.Name) (bad last_verified date)"
        }
    }

    # Fallback: check updated (legacy)
    if (-not $hasLastVerified -and $content -match '(?m)^updated:\s*(.+)$') {
        $dateStr = $Matches[1].Trim().Trim('"').Trim("'")
        try {
            $updatedDate = [DateTime]::Parse($dateStr)
            $age = ($now - $updatedDate).Days
            if ($age -gt $staleDaysUpdated) {
                $stalePages += "$($p.Name) (${age}d since update)"
            }
        } catch {
            # unparseable date, skip
        }
    }

    # Track pages with no verification date at all
    if (-not $hasLastVerified -and -not ($content -match '(?m)^updated:\s*')) {
        $unverifiedPages += $p.Name
    }
}

# --- 4. Missing frontmatter: pages without YAML frontmatter (--- block at top) ---
$noFrontmatter = @()
foreach ($p in $allPages) {
    $content = Get-Content $p.FullPath -Raw
    if (-not ($content -match '(?s)^---\s*\r?\n.*?\r?\n---')) {
        $noFrontmatter += $p.Name
    }
}

# --- 5. brain.md age ---
$brainAge = '?'
$brainStatus = 'UNKNOWN'
if (Test-Path $brainFile) {
    $brainContent = Get-Content $brainFile -Raw
    if ($brainContent -match 'Last refreshed:\s*(\S+)') {
        $dateStr = $Matches[1].Trim()
        try {
            $refreshDate = [DateTime]::Parse($dateStr)
            $brainDays = ($now - $refreshDate).Days
            $brainAge = "$brainDays days"
            if ($brainDays -gt 7) {
                $brainStatus = "STALE - refresh recommended"
            } else {
                $brainStatus = "OK"
            }
        } catch {
            $brainAge = 'unparseable'
            $brainStatus = 'WARN'
        }
    } else {
        $brainAge = 'no timestamp'
        $brainStatus = 'WARN - add Last refreshed: line'
    }
}

# --- 6. decisions.md entry count ---
$decisionCount = 0
$decisionStatus = 'OK'
if (Test-Path $decisionsFile) {
    $decContent = Get-Content $decisionsFile
    $decisionCount = ($decContent | Where-Object { $_ -match '^\s*-\s*\[' }).Count
    if ($decisionCount -gt 200) {
        $decisionStatus = "LARGE - consider archiving"
    }
}

# --- Output ---
Write-Host ""
Write-Host "Wiki Health Check"
Write-Host "================="
Write-Host "Pages: $totalPages"

if ($orphans.Count -eq 0) {
    Write-Host "Orphans: 0"
} else {
    Write-Host "Orphans: $($orphans.Count) ($($orphans -join ', '))"
}

if ($missingRefs.Count -eq 0) {
    Write-Host "Missing refs: 0"
} else {
    $refList = ($missingRefs | ForEach-Object { "[[$_]]" }) -join ', '
    Write-Host "Missing refs: $($missingRefs.Count) ($refList)"
}

if ($stalePages.Count -eq 0) {
    Write-Host "Stale: 0"
} else {
    Write-Host "Stale: $($stalePages.Count) ($($stalePages -join ', '))"
}

if ($unverifiedPages.Count -gt 0) {
    Write-Host "No last_verified: $($unverifiedPages.Count)"
}

Write-Host "No frontmatter: $($noFrontmatter.Count)"

Write-Host "brain.md age: $brainAge ($brainStatus)"
Write-Host "decisions.md: $decisionCount entries ($decisionStatus)"

$pct = if ($totalPages -gt 0) { [math]::Round(($coveredCount / $totalPages) * 100) } else { 0 }
Write-Host "Index coverage: $coveredCount/$totalPages ($pct%)"
Write-Host ""
