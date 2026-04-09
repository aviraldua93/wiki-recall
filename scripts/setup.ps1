<#
.SYNOPSIS
    wiki-recall setup wizard — creates your personal ~/.grain/ knowledge base.

.DESCRIPTION
    Interactive onboarding:
    1. Ask: name, GitHub identities, work domains
    2. Create ~/.grain/ directory structure
    3. Generate brain.md L0+L1 from your answers
    4. Generate copilot-instructions.md from template
    5. Index existing session_store (if available)
    6. Open Obsidian vault (if installed)

    Run once after cloning wiki-recall:
      powershell -ExecutionPolicy Bypass -File scripts/setup.ps1

.NOTES
    All data stays local in ~/.grain/. Nothing is pushed anywhere.
#>

$ErrorActionPreference = 'Stop'

$grainDir = Join-Path $env:USERPROFILE '.grain'
$templateDir = Join-Path $PSScriptRoot '..' 'templates'

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  wiki-recall setup wizard" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will create your personal knowledge base at $grainDir"
Write-Host "All data stays local. Nothing is pushed to any repo."
Write-Host ""

# --- Step 1: Gather info ---
$name = Read-Host "Your name (for brain.md L0 identity)"
$githubPersonal = Read-Host "GitHub personal username (e.g., yourusername)"
$githubWork = Read-Host "GitHub work username (leave blank if same)"
if ([string]::IsNullOrWhiteSpace($githubWork)) { $githubWork = $githubPersonal }

$domainsInput = Read-Host "Work domains (comma-separated, e.g., frontend,backend,infrastructure)"
$domains = ($domainsInput -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }

$principles = Read-Host "Your core work principles (comma-separated, e.g., ship fast, test everything)"
$principlesList = ($principles -split ',') | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' }

$commStyle = Read-Host "Your communication style (e.g., direct, concise, casual)"
$greeting = Read-Host "Your preferred greeting (e.g., Hey, Hi team, Hello)"
$signOff = Read-Host "Your sign off (e.g., Thanks, Best, Cheers)"

Write-Host ""
Write-Host "Setting up ~/.grain/ ..." -ForegroundColor Green

# --- Step 2: Create directory structure ---
$dirs = @(
    $grainDir,
    (Join-Path $grainDir 'wiki'),
    (Join-Path $grainDir 'wiki' 'projects'),
    (Join-Path $grainDir 'wiki' 'patterns'),
    (Join-Path $grainDir 'wiki' 'concepts'),
    (Join-Path $grainDir 'wiki' 'people'),
    (Join-Path $grainDir 'domains'),
    (Join-Path $grainDir 'reference'),
    (Join-Path $grainDir 'engine')
)

foreach ($d in $dirs) {
    if (-not (Test-Path $d)) {
        New-Item -ItemType Directory -Path $d -Force | Out-Null
        Write-Host "  Created: $d" -ForegroundColor DarkGray
    }
}

# --- Step 3: Generate brain.md ---
$nowIso = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
$principlesBlock = ""
foreach ($p in $principlesList) {
    $principlesBlock += "- $p`n"
}
if ([string]::IsNullOrWhiteSpace($principlesBlock)) {
    $principlesBlock = "- (add your principles here)`n"
}

$brainContent = @"
# Brain — $name
Last refreshed: $nowIso

## L0 — Identity
- Name: $name
- GitHub: $githubPersonal$(if ($githubWork -ne $githubPersonal) { " (personal), $githubWork (work)" } else { "" })
- Principles:
$principlesBlock
## L1 — Active Work

| Project | Status | Branch | Notes |
|---------|--------|--------|-------|
| (none yet) | — | — | Run refresh.ps1 after some sessions |

### Decisions (recent)
- (none yet — decisions are captured during sessions)

## Recently Learned
(empty — entries appear as you work)

## Routing
- Wiki: ~/.grain/wiki/ (projects, patterns, concepts)
- Domains: ~/.grain/domains/
- Decisions: ~/.grain/decisions.md
- Actions: ~/.grain/actions.md
- Engine: ~/.grain/engine/ (indexer, search, MCP server)
"@

$brainPath = Join-Path $grainDir 'brain.md'
if (-not (Test-Path $brainPath)) {
    Set-Content -Path $brainPath -Value $brainContent -Encoding UTF8
    Write-Host "  Generated: brain.md" -ForegroundColor Green
} else {
    Write-Host "  Skipped: brain.md (already exists)" -ForegroundColor Yellow
}

# --- Step 4: Copy template files ---
$templateFiles = @{
    'actions.md'    = (Join-Path $grainDir 'actions.md')
    'decisions.md'  = (Join-Path $grainDir 'decisions.md')
    'wiki-index.md' = (Join-Path $grainDir 'wiki' 'index.md')
}

foreach ($tmpl in $templateFiles.GetEnumerator()) {
    $src = Join-Path $templateDir $tmpl.Key
    $dst = $tmpl.Value
    if (-not (Test-Path $dst)) {
        if (Test-Path $src) {
            Copy-Item -Path $src -Destination $dst
            Write-Host "  Copied: $($tmpl.Key) -> $dst" -ForegroundColor DarkGray
        } else {
            # Create minimal version
            Set-Content -Path $dst -Value "# $($tmpl.Key -replace '\.md$','' -replace '-',' ')`n`n(empty — will be populated as you work)`n" -Encoding UTF8
            Write-Host "  Created: $dst (minimal)" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  Skipped: $($tmpl.Key) (already exists)" -ForegroundColor Yellow
    }
}

# --- Step 5: Create domain files ---
foreach ($domain in $domains) {
    $slug = $domain.ToLower() -replace '\s+', '-'
    $domainPath = Join-Path $grainDir 'domains' "$slug.md"
    if (-not (Test-Path $domainPath)) {
        $domainContent = @"
---
title: $domain
created: $nowIso
updated: $nowIso
last_verified: $(Get-Date -Format 'yyyy-MM-dd')
---

# $domain

## Overview
(Describe this work domain)

## Key Repos

## Key Contacts

## Notes
"@
        Set-Content -Path $domainPath -Value $domainContent -Encoding UTF8
        Write-Host "  Created domain: $slug.md" -ForegroundColor DarkGray
    }
}

# --- Step 6: Copy reference files ---
$repoRefDir = Join-Path $PSScriptRoot '..' 'reference'
$grainRefDir = Join-Path $grainDir 'reference'
if (Test-Path $repoRefDir) {
    Get-ChildItem -Path $repoRefDir -Filter '*.md' | ForEach-Object {
        $dst = Join-Path $grainRefDir $_.Name
        if (-not (Test-Path $dst)) {
            Copy-Item -Path $_.FullName -Destination $dst
            Write-Host "  Copied reference: $($_.Name)" -ForegroundColor DarkGray
        }
    }
}

# --- Step 7: Generate copilot-instructions.md ---
$instructionsPath = Join-Path $env:USERPROFILE '.copilot' 'copilot-instructions.md'
$copilotDir = Join-Path $env:USERPROFILE '.copilot'
if (-not (Test-Path $copilotDir)) {
    New-Item -ItemType Directory -Path $copilotDir -Force | Out-Null
}

if (-not (Test-Path $instructionsPath)) {
    $instructionsSrc = Join-Path $templateDir 'copilot-instructions.md'
    if (Test-Path $instructionsSrc) {
        $instrContent = Get-Content $instructionsSrc -Raw
        $instrContent = $instrContent -replace '\[YOUR_NAME\]', $name
        $instrContent = $instrContent -replace '\[YOUR_GITHUB\]', $githubPersonal
        Set-Content -Path $instructionsPath -Value $instrContent -Encoding UTF8
        Write-Host "  Generated: copilot-instructions.md" -ForegroundColor Green
    } else {
        Write-Host "  Skipped: copilot-instructions.md template not found" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Skipped: copilot-instructions.md (already exists)" -ForegroundColor Yellow
}

# --- Step 7b: Generate persona.md ---
$personaPath = Join-Path $grainDir 'persona.md'
if (-not (Test-Path $personaPath)) {
    $personaSrc = Join-Path $templateDir 'persona.md'
    if (Test-Path $personaSrc) {
        $personaContent = Get-Content $personaSrc -Raw
        $personaContent = $personaContent -replace '\[YOUR_NAME\]', $name
        $personaContent = $personaContent -replace '\[COMM_STYLE\]', $commStyle
        $personaContent = $personaContent -replace '\[GREETING\]', $greeting
        $personaContent = $personaContent -replace '\[SIGNOFF\]', $signOff
        Set-Content -Path $personaPath -Value $personaContent -Encoding UTF8
        Write-Host "  Generated: persona.md" -ForegroundColor Green
    } else {
        Write-Host "  Skipped: persona.md template not found" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Skipped: persona.md (already exists)" -ForegroundColor Yellow
}

# --- Step 7c: Copy comms.md domain ---
$commsSrc = Join-Path $templateDir 'domains' 'comms.md'
$commsDst = Join-Path $grainDir 'domains' 'comms.md'
if (-not (Test-Path $commsDst)) {
    if (Test-Path $commsSrc) {
        Copy-Item -Path $commsSrc -Destination $commsDst
        Write-Host "  Copied: domains/comms.md" -ForegroundColor DarkGray
    }
}

# --- Step 8: Copy .obsidian config and register vault ---
$obsidianSrc = Join-Path $PSScriptRoot '..' '.obsidian'
$obsidianDst = Join-Path $grainDir '.obsidian'
if ((Test-Path $obsidianSrc) -and -not (Test-Path $obsidianDst)) {
    Copy-Item -Path $obsidianSrc -Destination $obsidianDst -Recurse
    Write-Host "  Copied: .obsidian/ config" -ForegroundColor DarkGray
}

# --- Step 8b: Copy .gitignore template ---
$gitignoreSrc = Join-Path $templateDir 'grain-gitignore'
$gitignoreDst = Join-Path $grainDir '.gitignore'
if (-not (Test-Path $gitignoreDst)) {
    if (Test-Path $gitignoreSrc) {
        Copy-Item -Path $gitignoreSrc -Destination $gitignoreDst
        Write-Host "  Copied: .gitignore (PII protection)" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  Skipped: .gitignore (already exists)" -ForegroundColor Yellow
}

# --- Step 9: Try to index and harvest session_store ---
$engineDir = Join-Path $PSScriptRoot '..' 'engine'
$indexerPath = Join-Path $engineDir 'indexer.py'
$harvestPath = Join-Path $engineDir 'harvest.py'
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCmd -and (Test-Path $indexerPath)) {
    $sessionDb = Join-Path $env:USERPROFILE '.copilot' 'session-store.db'
    if (Test-Path $sessionDb) {
        # Count sessions to give user context
        $sessionCount = 0
        try {
            $countOutput = & python -c "import sqlite3; conn = sqlite3.connect('$($sessionDb -replace '\\','/')'); print(conn.execute('SELECT COUNT(*) FROM sessions').fetchone()[0]); conn.close()" 2>$null
            $sessionCount = [int]$countOutput
        } catch {}

        Write-Host ""
        Write-Host "Found session_store with $sessionCount existing session(s)." -ForegroundColor Cyan
        $runHarvest = Read-Host "Run harvest to populate your brain? [Y/n]"
        if ($runHarvest -ne 'n' -and $runHarvest -ne 'N') {
            Write-Host "  Indexing into ChromaDB..." -ForegroundColor Cyan
            try {
                & python $indexerPath 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
            } catch {
                Write-Host "  Indexing failed (you can run it later): $_" -ForegroundColor Yellow
            }

            if (Test-Path $harvestPath) {
                Write-Host "  Running harvest (dry-run preview)..." -ForegroundColor Cyan
                try {
                    & python $harvestPath 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
                    Write-Host ""
                    $autoHarvest = Read-Host "  Write these findings to your brain? [Y/n]"
                    if ($autoHarvest -ne 'n' -and $autoHarvest -ne 'N') {
                        & python $harvestPath --auto 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
                        Write-Host "  ✓ Harvest complete!" -ForegroundColor Green
                    }
                } catch {
                    Write-Host "  Harvest failed (you can run it later): $_" -ForegroundColor Yellow
                }
            }

            # Mark harvest timestamp
            $lastHarvested = Join-Path $grainDir 'engine' '.last_harvested'
            if (-not (Test-Path $lastHarvested)) {
                $nowIsoHarvest = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.000Z')
                Set-Content -Path $lastHarvested -Value $nowIsoHarvest -Encoding UTF8
            }
        } else {
            Write-Host "  Skipped — run 'python engine/harvest.py' later to populate." -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  No session_store found (will index after first Copilot CLI sessions)" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  Python not found — skip indexing (run 'python engine/indexer.py' later)" -ForegroundColor Yellow
}

# --- Step 10: Open Obsidian ---
$obsidianConfigPath = Join-Path $env:APPDATA 'obsidian' 'obsidian.json'
if (Test-Path $obsidianConfigPath) {
    # Obsidian is installed — check if vault is registered
    try {
        $obsidianConfig = Get-Content $obsidianConfigPath -Raw | ConvertFrom-Json
        $vaultPath = $grainDir -replace '\\', '/'
        $vaultRegistered = $false

        if ($obsidianConfig.vaults -and $obsidianConfig.vaults.PSObject.Properties) {
            foreach ($prop in $obsidianConfig.vaults.PSObject.Properties) {
                $vaultEntry = $prop.Value
                if ($vaultEntry.path -and ($vaultEntry.path -replace '\\', '/') -eq $vaultPath) {
                    $vaultRegistered = $true
                    break
                }
            }
        }

        if (-not $vaultRegistered) {
            # Auto-register the vault
            $vaultId = [guid]::NewGuid().ToString('N').Substring(0, 16)
            $newVault = @{ path = $vaultPath }

            if (-not $obsidianConfig.vaults) {
                $obsidianConfig | Add-Member -NotePropertyName 'vaults' -NotePropertyValue ([PSCustomObject]@{})
            }
            $obsidianConfig.vaults | Add-Member -NotePropertyName $vaultId -NotePropertyValue ([PSCustomObject]$newVault)
            $obsidianConfig | ConvertTo-Json -Depth 10 | Set-Content $obsidianConfigPath -Encoding UTF8
            Write-Host "  Registered ~/.grain/ as Obsidian vault" -ForegroundColor Green
        } else {
            Write-Host "  Obsidian vault already registered" -ForegroundColor DarkGray
        }

        Write-Host ""
        $openVault = Read-Host "Open ~/.grain/ in Obsidian? (y/N)"
        if ($openVault -eq 'y' -or $openVault -eq 'Y') {
            Start-Process "obsidian://open?vault=$([Uri]::EscapeDataString((Split-Path $grainDir -Leaf)))"
        }
    } catch {
        Write-Host "  Could not read Obsidian config: $($_.Exception.Message)" -ForegroundColor Yellow
        Write-Host "  Open Obsidian manually and use 'Open folder as vault' -> select ~/.grain/" -ForegroundColor Yellow
        Write-Host "  See docs/obsidian-setup.md for details" -ForegroundColor DarkGray
    }
} else {
    Write-Host ""
    Write-Host "  Obsidian not detected — skipping vault registration." -ForegroundColor Yellow
    Write-Host "  Install Obsidian from https://obsidian.md for visual wiki browsing." -ForegroundColor DarkGray
    Write-Host "  After installing, see docs/obsidian-setup.md for manual setup." -ForegroundColor DarkGray
}

# --- Step 11: Set up automatic maintenance ---
Write-Host ""
$setupMaintenance = Read-Host "Set up automatic maintenance? (Y/n)"
if ($setupMaintenance -ne 'n' -and $setupMaintenance -ne 'N') {
    Write-Host "  Frequency options:" -ForegroundColor Cyan
    Write-Host "    1. hourly        — refresh every hour (recommended)" -ForegroundColor White
    Write-Host "    2. every4hours   — refresh every 4 hours" -ForegroundColor White
    Write-Host "    3. daily         — refresh once a day" -ForegroundColor White
    $freqChoice = Read-Host "  Frequency? (1/2/3, default: 1)"
    $freq = switch ($freqChoice) {
        '2' { 'every4hours' }
        '3' { 'daily' }
        default { 'hourly' }
    }

    $schedulerScript = Join-Path $PSScriptRoot 'setup-scheduler.ps1'
    if (Test-Path $schedulerScript) {
        try {
            & powershell -ExecutionPolicy Bypass -File $schedulerScript -Frequency $freq
            Write-Host "  Automatic maintenance configured ($freq)!" -ForegroundColor Green
        } catch {
            Write-Host "  Could not set up scheduler: $($_.Exception.Message)" -ForegroundColor Yellow
            Write-Host "  You can run it manually later: scripts/setup-scheduler.ps1 -Frequency $freq" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  setup-scheduler.ps1 not found — skip scheduler setup" -ForegroundColor Yellow
    }
} else {
    Write-Host "  Skipping automatic maintenance (run setup-scheduler.ps1 later)" -ForegroundColor DarkGray
}

# --- Done ---
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Setup complete!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Your knowledge base is at: $grainDir" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:"
Write-Host "  1. Start using Copilot CLI — your sessions will be mined automatically"
Write-Host "  2. Run 'python engine/harvest.py' to extract decisions & patterns"
Write-Host "  3. Run 'scripts/refresh.ps1' periodically to update brain.md"
Write-Host "  4. Run 'scripts/lint.ps1' to check wiki health"
Write-Host "  5. Run 'python engine/indexer.py' to reindex ChromaDB"
Write-Host "  6. Run 'scripts/maintenance.ps1' for full maintenance cycle"
Write-Host ""
