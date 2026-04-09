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
$now = Get-Date

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

# Persona questions
Write-Host ""
Write-Host "--- Communication Style (for persona.md) ---" -ForegroundColor Cyan
$commStyle = Read-Host "How would you describe your communication style? (casual/formal/mixed)"
if ([string]::IsNullOrWhiteSpace($commStyle)) { $commStyle = "mixed" }
$greeting = Read-Host "How do you usually greet people? (Hey/Hi/Dear/No greeting)"
if ([string]::IsNullOrWhiteSpace($greeting)) { $greeting = "Hey" }
$signoff = Read-Host "How do you sign off? (Thanks/Best/Cheers/Just name)"
if ([string]::IsNullOrWhiteSpace($signoff)) { $signoff = "Thanks" }

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
    'people-readme.md' = (Join-Path $grainDir 'wiki' 'people' 'README.md')
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

# --- Step 4b: Generate persona.md ---
$personaPath = Join-Path $grainDir 'persona.md'
if (-not (Test-Path $personaPath)) {
    $personaSrc = Join-Path $templateDir 'persona.md'
    if (Test-Path $personaSrc) {
        $personaContent = Get-Content $personaSrc -Raw
        $personaContent = $personaContent -replace '\[YOUR_NAME\]', $name
        $personaContent = $personaContent -replace '\[COMM_STYLE\]', $commStyle
        $personaContent = $personaContent -replace '\[GREETING\]', $greeting
        $personaContent = $personaContent -replace '\[SIGNOFF\]', $signoff
        Set-Content -Path $personaPath -Value $personaContent -Encoding UTF8
        Write-Host "  Generated: persona.md" -ForegroundColor Green
    }
} else {
    Write-Host "  Skipped: persona.md (already exists)" -ForegroundColor Yellow
}

# --- Step 4c: Generate domains/comms.md ---
$commsPath = Join-Path $grainDir 'domains' 'comms.md'
if (-not (Test-Path $commsPath)) {
    $commsSrc = Join-Path $templateDir 'domains' 'comms.md'
    if (Test-Path $commsSrc) {
        Copy-Item -Path $commsSrc -Destination $commsPath
        Write-Host "  Copied: domains/comms.md" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  Skipped: domains/comms.md (already exists)" -ForegroundColor Yellow
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
last_verified: $($now.ToString('yyyy-MM-dd'))
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

# --- Step 8: Copy .obsidian config ---
$obsidianSrc = Join-Path $PSScriptRoot '..' '.obsidian'
$obsidianDst = Join-Path $grainDir '.obsidian'
if ((Test-Path $obsidianSrc) -and -not (Test-Path $obsidianDst)) {
    Copy-Item -Path $obsidianSrc -Destination $obsidianDst -Recurse
    Write-Host "  Copied: .obsidian/ config" -ForegroundColor DarkGray
}

# --- Step 9: Try to index session_store ---
$engineDir = Join-Path $PSScriptRoot '..' 'engine'
$indexerPath = Join-Path $engineDir 'indexer.py'
$pythonCmd = Get-Command python -ErrorAction SilentlyContinue
if ($pythonCmd -and (Test-Path $indexerPath)) {
    $sessionDb = Join-Path $env:USERPROFILE '.copilot' 'session-store.db'
    if (Test-Path $sessionDb) {
        Write-Host ""
        Write-Host "Found session_store — indexing into ChromaDB..." -ForegroundColor Cyan
        try {
            & python $indexerPath 2>&1 | ForEach-Object { Write-Host "  $_" -ForegroundColor DarkGray }
        } catch {
            Write-Host "  Indexing failed (you can run it later): $_" -ForegroundColor Yellow
        }
    } else {
        Write-Host "  No session_store found (will index after first Copilot CLI sessions)" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  Python not found — skip indexing (run 'python engine/indexer.py' later)" -ForegroundColor Yellow
}

# --- Step 10: Initialize .last_harvested ---
$lastHarvestedPath = Join-Path $grainDir 'engine' '.last_harvested'
if (-not (Test-Path $lastHarvestedPath)) {
    $harvestTimestamp = $now.ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ss.000Z')
    Set-Content -Path $lastHarvestedPath -Value $harvestTimestamp -Encoding UTF8
    Write-Host "  Set .last_harvested to $harvestTimestamp (first harvest catches only new sessions)" -ForegroundColor DarkGray
}

# --- Step 11: Open Obsidian ---
$obsidian = Get-Command obsidian -ErrorAction SilentlyContinue
if ($obsidian) {
    Write-Host ""
    $openVault = Read-Host "Open ~/.grain/ in Obsidian? (y/N)"
    if ($openVault -eq 'y' -or $openVault -eq 'Y') {
        Start-Process "obsidian://open?vault=$([Uri]::EscapeDataString($grainDir))"
    }
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
Write-Host "  2. Run 'scripts/harvest.ps1' to auto-capture decisions and patterns"
Write-Host "  3. Run 'scripts/refresh.ps1' periodically to update brain.md"
Write-Host "  4. Run 'scripts/lint.ps1' to check wiki health (staleness detection)"
Write-Host "  5. Run 'python engine/indexer.py' to reindex ChromaDB"
Write-Host ""
