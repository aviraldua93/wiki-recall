<#
.SYNOPSIS
    wiki-recall setup wizard -- creates your personal ~/.grain/ knowledge base.

.DESCRIPTION
    Interactive onboarding with three modes:

    --Quick     Form-based setup (5 min). Produces a minimal brain.
    --Interview Deep interview mode (15-30 min). Copilot CLI interviews you,
                mines your sessions, and produces a 10x richer brain.
    --Adopt <path>  Scan an existing brain directory, report findings, add missing
                    pieces (RESOLVER.md, dream.ps1, format upgrades) WITHOUT
                    overwriting existing files. Use -WhatIf for preview.

    If neither flag is passed, the wizard prompts you to choose.

    Run once after cloning wiki-recall:
      powershell -ExecutionPolicy Bypass -File scripts/setup.ps1
      powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -Quick
      powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -Interview
      powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -Adopt ~/.grain
      powershell -ExecutionPolicy Bypass -File scripts/setup.ps1 -Adopt ~/.grain -WhatIf

.NOTES
    All data stays local in ~/.grain/. Nothing is pushed anywhere.
#>

param(
    [switch]$Interview,
    [switch]$Quick,
    [string]$Adopt = "",
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

$grainDir = Join-Path $HOME '.grain'
$templateDir = Join-Path $PSScriptRoot '..' 'templates'

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  wiki-recall setup wizard" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "This will create your personal knowledge base at $grainDir"
Write-Host "All data stays local. Nothing is pushed to any repo."
Write-Host ""

# --- Adopt mode: scan and upgrade existing brain ---
if ($Adopt -ne "") {
    $adoptPath = $Adopt
    if (-not (Test-Path $adoptPath)) {
        Write-Host "ERROR: Path not found: $adoptPath" -ForegroundColor Red
        exit 1
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  wiki-recall Adopt Mode" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Scanning: $adoptPath"
    Write-Host ""

    # --- Phase 1: Scan existing structure ---
    Write-Host "Phase 1: Scanning existing structure..." -ForegroundColor Cyan
    $findings = @{
        Exists = @()
        Missing = @()
        NeedsTier = @()
        NeedsCompiledTruth = @()
    }

    # Check core files
    $coreFiles = @{
        'brain.md'      = (Join-Path $adoptPath 'brain.md')
        'decisions.md'  = (Join-Path $adoptPath 'decisions.md')
        'actions.md'    = (Join-Path $adoptPath 'actions.md')
        'persona.md'    = (Join-Path $adoptPath 'persona.md')
        'RESOLVER.md'   = (Join-Path $adoptPath 'RESOLVER.md')
        '.gitignore'    = (Join-Path $adoptPath '.gitignore')
    }

    foreach ($file in $coreFiles.GetEnumerator()) {
        if (Test-Path $file.Value) {
            $findings.Exists += "[OK] $($file.Key)"
        } else {
            $findings.Missing += "[X] $($file.Key)"
        }
    }

    # Check directories
    $coreDirs = @(
        'wiki',
        (Join-Path 'wiki' 'projects'),
        (Join-Path 'wiki' 'people'),
        (Join-Path 'wiki' 'patterns'),
        (Join-Path 'wiki' 'concepts'),
        'domains',
        'engine',
        'scripts',
        'reference'
    )

    foreach ($d in $coreDirs) {
        $fullPath = Join-Path $adoptPath $d
        if (Test-Path $fullPath) {
            $findings.Exists += "[OK] $d/"
        } else {
            $findings.Missing += "[X] $d/"
        }
    }

    # Check scripts
    $scriptFiles = @('dream.ps1', 'maintenance.ps1', 'backup.ps1', 'lint.ps1', 'refresh.ps1', 'harvest.ps1')
    foreach ($script in $scriptFiles) {
        $scriptPath = Join-Path $adoptPath 'scripts' $script
        if (Test-Path $scriptPath) {
            $findings.Exists += "[OK] scripts/$script"
        } else {
            $findings.Missing += "[X] scripts/$script"
        }
    }

    # Check copilot-instructions.md (live location is ~/.github/)
    $githubCopilot = Join-Path $HOME '.github' 'copilot-instructions.md'
    $grainCopilot = Join-Path $adoptPath 'copilot-instructions.md'
    if (Test-Path $githubCopilot) {
        $findings.Exists += "[OK] copilot-instructions.md (live at ~/.github/)"
    } elseif (Test-Path $grainCopilot) {
        $findings.Exists += "[WARN] copilot-instructions.md (in ~/.grain/ only -- dead file, needs wiring to ~/.github/)"
    } else {
        $findings.Missing += "[X] copilot-instructions.md"
    }

    # --- Phase 2: Scan entity pages for format issues ---
    Write-Host "Phase 2: Scanning entity pages for format issues..." -ForegroundColor Cyan
    $wikiDir = Join-Path $adoptPath 'wiki'
    if (Test-Path $wikiDir) {
        $allPages = Get-ChildItem -Path $wikiDir -Recurse -Filter '*.md' |
            Where-Object { $_.Name -ne 'index.md' -and $_.Name -ne 'README.md' -and $_.FullName -notlike '*\.raw\*' }

        foreach ($page in $allPages) {
            $content = Get-Content $page.FullName -Raw -ErrorAction SilentlyContinue
            if (-not $content) { continue }

            # Check for tier field in frontmatter
            if ($content -match '(?s)^---\s*\r?\n.*?\r?\n---') {
                $frontmatter = $Matches[0]
                if ($frontmatter -notmatch 'tier:') {
                    $relPath = $page.FullName.Replace($adoptPath, '').TrimStart('\', '/')
                    $findings.NeedsTier += $relPath
                }
            } else {
                # No frontmatter at all
                $relPath = $page.FullName.Replace($adoptPath, '').TrimStart('\', '/')
                $findings.NeedsTier += "$relPath (no frontmatter)"
            }

            # Check for compiled-truth format
            if ($content -notmatch '## Compiled Truth') {
                $relPath = $page.FullName.Replace($adoptPath, '').TrimStart('\', '/')
                $findings.NeedsCompiledTruth += $relPath
            }
        }
    }

    # --- Report findings ---
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host "  Scan Results" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host ""

    Write-Host "Existing:" -ForegroundColor Green
    foreach ($item in $findings.Exists) {
        Write-Host "  $item" -ForegroundColor Green
    }

    if ($findings.Missing.Count -gt 0) {
        Write-Host ""
        Write-Host "Missing:" -ForegroundColor Yellow
        foreach ($item in $findings.Missing) {
            Write-Host "  $item" -ForegroundColor Yellow
        }
    }

    if ($findings.NeedsTier.Count -gt 0) {
        Write-Host ""
        Write-Host "Pages without tier field ($($findings.NeedsTier.Count)):" -ForegroundColor Yellow
        foreach ($item in $findings.NeedsTier | Select-Object -First 10) {
            Write-Host "  - $item" -ForegroundColor Yellow
        }
        if ($findings.NeedsTier.Count -gt 10) {
            Write-Host "  ... and $($findings.NeedsTier.Count - 10) more" -ForegroundColor Yellow
        }
    }

    if ($findings.NeedsCompiledTruth.Count -gt 0) {
        Write-Host ""
        Write-Host "Pages without compiled-truth format ($($findings.NeedsCompiledTruth.Count)):" -ForegroundColor Yellow
        foreach ($item in $findings.NeedsCompiledTruth | Select-Object -First 10) {
            Write-Host "  - $item" -ForegroundColor Yellow
        }
        if ($findings.NeedsCompiledTruth.Count -gt 10) {
            Write-Host "  ... and $($findings.NeedsCompiledTruth.Count - 10) more" -ForegroundColor Yellow
        }
    }

    # --- Phase 3: Add missing structural files ---
    Write-Host ""
    if ($WhatIf) {
        Write-Host "WhatIf: Would add missing structural files" -ForegroundColor Cyan
    } else {
        Write-Host "Adding missing structural files..." -ForegroundColor Cyan
    }

    # Create missing directories
    foreach ($d in $coreDirs) {
        $fullPath = Join-Path $adoptPath $d
        if (-not (Test-Path $fullPath)) {
            if ($WhatIf) {
                Write-Host "  WhatIf: Would create directory: $d" -ForegroundColor DarkGray
            } else {
                New-Item -ItemType Directory -Path $fullPath -Force | Out-Null
                Write-Host "  Created: $d/" -ForegroundColor Green
            }
        }
    }

    # Copy missing structural files WITHOUT overwriting
    $structuralFiles = @{
        'RESOLVER.md'          = (Join-Path $templateDir 'RESOLVER.md')
        '.gitignore'           = (Join-Path $templateDir 'grain-gitignore')
    }

    foreach ($sf in $structuralFiles.GetEnumerator()) {
        $dst = Join-Path $adoptPath $sf.Key
        $src = $sf.Value
        if ($sf.Key -eq '.gitignore') {
            $dst = Join-Path $adoptPath '.gitignore'
        }
        if (-not (Test-Path $dst)) {
            if (Test-Path $src) {
                if ($WhatIf) {
                    Write-Host "  WhatIf: Would copy $($sf.Key)" -ForegroundColor DarkGray
                } else {
                    Copy-Item -Path $src -Destination $dst
                    Write-Host "  Copied: $($sf.Key)" -ForegroundColor Green
                }
            }
        } else {
            Write-Host "  Skipped: $($sf.Key) (already exists)" -ForegroundColor DarkGray
        }
    }

    # --- Wire copilot-instructions.md to BOTH ~/.grain/ (backup) AND ~/.github/ (live) ---
    $copilotSrc = Join-Path $templateDir 'copilot-instructions.md'
    $copilotBackup = Join-Path $adoptPath 'copilot-instructions.md'
    $githubDir = Join-Path $HOME '.github'
    $copilotLive = Join-Path $githubDir 'copilot-instructions.md'

    # RESOLVER routing rules to inline into copilot-instructions.md
    $resolverRules = @"

## Knowledge Filing (RESOLVER)

When new knowledge arrives, route it:
1. About a **PERSON** -> wiki/people/<name>.md
2. About a **PROJECT** -> wiki/projects/<name>.md
3. About a **BUG/FIX** -> wiki/patterns/<name>.md
4. A **TECH CONCEPT** -> wiki/concepts/<name>.md
5. A **DECISION** -> see Decision Write-Back tiers below
6. A **COMMITMENT** -> actions.md
7. A **VISION/STRATEGY** -> tag as type: strategy in frontmatter
8. None of the above -> harvest-suggestions.md
"@

    if ($WhatIf) {
        Write-Host "  WhatIf: Would copy copilot-instructions.md to $copilotBackup (backup)" -ForegroundColor DarkGray
        Write-Host "  WhatIf: Would wire copilot-instructions.md to $copilotLive (live)" -ForegroundColor DarkGray
    } else {
        # Always save backup copy to ~/.grain/
        if (Test-Path $copilotSrc) {
            Copy-Item -Path $copilotSrc -Destination $copilotBackup -Force
            Write-Host "  Copied: copilot-instructions.md (backup to $adoptPath)" -ForegroundColor Green
        }

        # Wire to ~/.github/copilot-instructions.md (live location)
        if (-not (Test-Path $githubDir)) {
            New-Item -ItemType Directory -Path $githubDir -Force | Out-Null
        }

        if (Test-Path $copilotLive) {
            # MERGE: existing file -- add wiki-recall sections if not already present
            $existingContent = Get-Content $copilotLive -Raw
            $sectionsAdded = @()

            # Check and add RESOLVER routing if missing
            if ($existingContent -notmatch 'Knowledge Filing \(RESOLVER\)') {
                $existingContent = $existingContent.TrimEnd() + "`n" + $resolverRules
                $sectionsAdded += "RESOLVER routing"
            }

            # Check and add Decision Write-Back if missing
            if ($existingContent -notmatch 'Decision Write-Back \(Tiered\)') {
                $templateContent = Get-Content $copilotSrc -Raw
                if ($templateContent -match '(?s)(## Decision Write-Back \(Tiered\).+?)(?=\n## |\z)') {
                    $decisionSection = "`n`n" + $Matches[1].TrimEnd()
                    $existingContent = $existingContent.TrimEnd() + $decisionSection
                    $sectionsAdded += "Decision Write-Back (tiered)"
                }
            }

            # Check and add Knowledge Base section if missing
            if ($existingContent -notmatch '## Knowledge Base') {
                $templateContent = Get-Content $copilotSrc -Raw
                if ($templateContent -match '(?s)(## Knowledge Base.+?)(?=\n## )') {
                    $kbSection = "`n`n" + $Matches[1].TrimEnd()
                    $existingContent = $existingContent.TrimEnd() + $kbSection
                    $sectionsAdded += "Knowledge Base"
                }
            }

            Set-Content -Path $copilotLive -Value $existingContent -NoNewline
            if ($sectionsAdded.Count -gt 0) {
                Write-Host "  Merged into existing $copilotLive`:" -ForegroundColor Green
                foreach ($s in $sectionsAdded) {
                    Write-Host "    + $s" -ForegroundColor Green
                }
            } else {
                Write-Host "  Skipped: $copilotLive (wiki-recall sections already present)" -ForegroundColor DarkGray
            }
        } else {
            # Fresh copy + inline RESOLVER rules
            if (Test-Path $copilotSrc) {
                $templateContent = (Get-Content $copilotSrc -Raw).TrimEnd()
                $fullContent = $templateContent + "`n" + $resolverRules
                Set-Content -Path $copilotLive -Value $fullContent -NoNewline
                Write-Host "  Wired: copilot-instructions.md to $copilotLive (live)" -ForegroundColor Green
            }
        }

        Write-Host ""
        Write-Host "  IMPORTANT: Copilot CLI reads from $copilotLive" -ForegroundColor Yellow
        Write-Host "  The backup copy in $adoptPath is for reference only." -ForegroundColor Yellow
    }

    # Copy scripts to adopted brain's scripts directory if missing
    $adoptScriptsDir = Join-Path $adoptPath 'scripts'
    if (-not (Test-Path $adoptScriptsDir)) {
        if (-not $WhatIf) {
            New-Item -ItemType Directory -Path $adoptScriptsDir -Force | Out-Null
        }
    }

    $scriptsToAdopt = @('dream.ps1', 'maintenance.ps1', 'backup.ps1', 'lint.ps1', 'refresh.ps1', 'harvest.ps1', 'setup-scheduler.ps1', 'compact.ps1')
    foreach ($script in $scriptsToAdopt) {
        $src = Join-Path $PSScriptRoot $script
        $dst = Join-Path $adoptScriptsDir $script
        if (-not (Test-Path $dst)) {
            if (Test-Path $src) {
                if ($WhatIf) {
                    Write-Host "  WhatIf: Would copy scripts/$script" -ForegroundColor DarkGray
                } else {
                    Copy-Item -Path $src -Destination $dst
                    Write-Host "  Copied: scripts/$script" -ForegroundColor Green
                }
            }
        } else {
            Write-Host "  Skipped: scripts/$script (already exists)" -ForegroundColor DarkGray
        }
    }

    # Copy engine files if missing
    $adoptEngineDir = Join-Path $adoptPath 'engine'
    $engineSrc = Join-Path $PSScriptRoot '..' 'engine'
    if (Test-Path $engineSrc) {
        Get-ChildItem -Path $engineSrc -Filter '*.py' | ForEach-Object {
            $dst = Join-Path $adoptEngineDir $_.Name
            if (-not (Test-Path $dst)) {
                if ($WhatIf) {
                    Write-Host "  WhatIf: Would copy engine/$($_.Name)" -ForegroundColor DarkGray
                } else {
                    Copy-Item -Path $_.FullName -Destination $dst
                    Write-Host "  Copied: engine/$($_.Name)" -ForegroundColor Green
                }
            }
        }
    }

    # --- Phase 4: Offer tier field upgrade ---
    if ($findings.NeedsTier.Count -gt 0) {
        Write-Host ""
        if ($WhatIf) {
            Write-Host "WhatIf: Would offer to add tier field to $($findings.NeedsTier.Count) pages" -ForegroundColor Cyan
        } else {
            $addTier = Read-Host "Add tier field to $($findings.NeedsTier.Count) pages without it? (Y/n)"
            if ($addTier -ne 'n' -and $addTier -ne 'N') {
                $pythonCmd = Get-Command python -ErrorAction SilentlyContinue
                if ($pythonCmd) {
                    foreach ($relPath in $findings.NeedsTier) {
                        # Strip "(no frontmatter)" suffix if present
                        $cleanPath = $relPath -replace '\s*\(no frontmatter\)$', ''
                        $fullPath = Join-Path $adoptPath $cleanPath
                        if (Test-Path $fullPath) {
                            try {
                                $env:GRAIN_ROOT = $adoptPath
                                & python -c "
import sys; sys.path.insert(0, '$($PSScriptRoot -replace '\\','/')/..')
from engine.harvest import write_tier
from pathlib import Path
write_tier(Path(r'$fullPath'), 3)
print('  Added tier:3 to $cleanPath')
" 2>&1 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }
                            } catch {
                                Write-Host "  Failed to add tier to $cleanPath`: $_" -ForegroundColor Yellow
                            }
                        }
                    }
                    Write-Host "  [OK] Tier field added to eligible pages" -ForegroundColor Green
                } else {
                    Write-Host "  Python not found -- add tier fields manually" -ForegroundColor Yellow
                }
            }
        }
    }

    # --- Done ---
    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Adopt complete!" -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Your adopted brain is at: $adoptPath" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Wiring summary:" -ForegroundColor Yellow
    Write-Host "  - copilot-instructions.md -> $copilotLive (live, read by Copilot CLI)" -ForegroundColor Yellow
    Write-Host "  - copilot-instructions.md -> $copilotBackup (backup copy)" -ForegroundColor Yellow
    Write-Host "  - RESOLVER routing rules inlined into copilot-instructions.md" -ForegroundColor Yellow
    Write-Host "  - Decision write-back (3 tiers) added to copilot-instructions.md" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Next steps:"
    Write-Host "  1. Review the findings above"
    Write-Host "  2. Run 'scripts/lint.ps1' to check wiki health"
    Write-Host "  3. Run 'python engine/hygiene.py' for deep health check"
    Write-Host "  4. Run 'python engine/retrofit.py' for interactive brain upgrade"
    Write-Host "  5. Set GRAIN_ROOT=$adoptPath to use this brain"
    Write-Host ""
    exit 0
}

# --- Mode selection ---
if (-not $Interview -and -not $Quick) {
    Write-Host "Choose setup mode:" -ForegroundColor Cyan
    Write-Host "  1. Quick setup    (5 min)     -- form-based, produces minimal brain" -ForegroundColor White
    Write-Host "  2. Deep interview (15-30 min) -- Copilot CLI interviews you, mines sessions" -ForegroundColor White
    Write-Host ""
    $modeChoice = Read-Host "Which mode? (1/2, default: 1)"
    if ($modeChoice -eq '2') {
        $Interview = $true
    } else {
        $Quick = $true
    }
}

# --- Interview mode ---
if ($Interview) {
    Write-Host "Setting up directory structure for interview mode..." -ForegroundColor Green

    # Create the same directory structure as quick mode
    # NOTE: .archive/ is created here so the interview cleanup step (Step 11)
    # can move interview-protocol.md to .archive/interview-protocol-completed.md
    # when the interview finishes. See interview-protocol.md cleanup step.
    $dirs = @(
        $grainDir,
        (Join-Path $grainDir 'wiki'),
        (Join-Path $grainDir 'wiki' 'projects'),
        (Join-Path $grainDir 'wiki' 'patterns'),
        (Join-Path $grainDir 'wiki' 'concepts'),
        (Join-Path $grainDir 'wiki' 'people'),
        (Join-Path $grainDir 'domains'),
        (Join-Path $grainDir 'reference'),
        (Join-Path $grainDir 'engine'),
        (Join-Path $grainDir 'scripts'),
        (Join-Path $grainDir '.archive')
    )

    foreach ($d in $dirs) {
        if (-not (Test-Path $d)) {
            New-Item -ItemType Directory -Path $d -Force | Out-Null
            Write-Host "  Created: $d" -ForegroundColor DarkGray
        }
    }

    # Copy template files that the interview will build on
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
            } else {
                Set-Content -Path $dst -Value "# $($tmpl.Key -replace '\.md$','' -replace '-',' ')`n`n(empty -- will be populated during interview)`n" -Encoding UTF8
            }
        }
    }

    # Copy reference files
    $repoRefDir = Join-Path $PSScriptRoot '..' 'reference'
    $grainRefDir = Join-Path $grainDir 'reference'
    if (Test-Path $repoRefDir) {
        Get-ChildItem -Path $repoRefDir -Filter '*.md' | ForEach-Object {
            $dst = Join-Path $grainRefDir $_.Name
            if (-not (Test-Path $dst)) {
                Copy-Item -Path $_.FullName -Destination $dst
            }
        }
    }

    # Copy engine files for session mining
    $engineSrc = Join-Path $PSScriptRoot '..' 'engine'
    $engineDst = Join-Path $grainDir 'engine'
    if (Test-Path $engineSrc) {
        Get-ChildItem -Path $engineSrc -Filter '*.py' | ForEach-Object {
            $dst = Join-Path $engineDst $_.Name
            if (-not (Test-Path $dst)) {
                Copy-Item -Path $_.FullName -Destination $dst
            }
        }
    }

    # Copy protocols directory
    $protocolSrcDir = Join-Path $PSScriptRoot '..' 'protocols'
    $protocolDstDir = Join-Path $grainDir 'protocols'
    if (Test-Path $protocolSrcDir) {
        if (-not (Test-Path $protocolDstDir)) {
            New-Item -ItemType Directory -Path $protocolDstDir -Force | Out-Null
        }
        $protocolFiles = Get-ChildItem -Path $protocolSrcDir -Filter '*.md'
        foreach ($pf in $protocolFiles) {
            Copy-Item -Path $pf.FullName -Destination (Join-Path $protocolDstDir $pf.Name) -Force
        }
        Write-Host "  Copied: protocols/ ($($protocolFiles.Count) protocol files)" -ForegroundColor Green
    } else {
        Write-Host "  Warning: protocols/ directory not found" -ForegroundColor Yellow
    }

    # Copy .obsidian config
    $obsidianSrc = Join-Path $PSScriptRoot '..' '.obsidian'
    $obsidianDst = Join-Path $grainDir '.obsidian'
    if ((Test-Path $obsidianSrc) -and -not (Test-Path $obsidianDst)) {
        Copy-Item -Path $obsidianSrc -Destination $obsidianDst -Recurse
    }

    # Copy .gitignore
    $gitignoreSrc = Join-Path $templateDir 'grain-gitignore'
    $gitignoreDst = Join-Path $grainDir '.gitignore'
    if (-not (Test-Path $gitignoreDst)) {
        if (Test-Path $gitignoreSrc) {
            Copy-Item -Path $gitignoreSrc -Destination $gitignoreDst
        }
    }

    # --- #43: Wire copilot-instructions.md as fallback for interview mode ---
    # The interview protocol (Step 10) will generate a richer version, but we
    # pre-copy the template so there's always a working copilot-instructions.md
    # even if the interview is interrupted or skipped partway through.
    $copilotSrc = Join-Path $templateDir 'copilot-instructions.md'
    $copilotGrain = Join-Path $grainDir 'copilot-instructions.md'
    $githubDir = Join-Path $HOME '.github'
    $copilotLive = Join-Path $githubDir 'copilot-instructions.md'

    if (Test-Path $copilotSrc) {
        # Copy template to ~/.grain/ (backup copy, placeholders left for interview to fill)
        if (-not (Test-Path $copilotGrain)) {
            Copy-Item -Path $copilotSrc -Destination $copilotGrain
            Write-Host "  Copied: copilot-instructions.md (to ~/.grain/, placeholders for interview)" -ForegroundColor Green
        }

        # Create ~/.github/ and wire copilot-instructions.md there (live location)
        if (-not (Test-Path $githubDir)) {
            New-Item -ItemType Directory -Path $githubDir -Force | Out-Null
            Write-Host "  Created: ~/.github/" -ForegroundColor DarkGray
        }
        if (-not (Test-Path $copilotLive)) {
            Copy-Item -Path $copilotSrc -Destination $copilotLive
            Write-Host "  Wired: copilot-instructions.md to $copilotLive (live fallback)" -ForegroundColor Green
            Write-Host "  NOTE: [YOUR_NAME] and [YOUR_GITHUB] placeholders will be filled by the interview" -ForegroundColor Yellow
        } else {
            Write-Host "  Skipped: $copilotLive (already exists)" -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  Warning: copilot-instructions.md template not found" -ForegroundColor Yellow
    }

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Green
    Write-Host "  Starting deep interview mode..." -ForegroundColor Green
    Write-Host "========================================" -ForegroundColor Green
    Write-Host ""
    Write-Host "Run this in your terminal:" -ForegroundColor Cyan
    Write-Host ""
    Write-Host '  copilot -p "Read ~/.grain/protocols/interview-protocol.md and follow it step by step to set up my knowledge base."' -ForegroundColor White
    Write-Host ""
    Write-Host "The interview takes 15-30 minutes. Copilot will mine your sessions,"
    Write-Host "ask about your work domains, people, decisions, and writing style."
    Write-Host "The result is a 10x richer brain than quick setup."
    Write-Host ""
    exit 0
}

# --- Quick mode (original form-based setup below) ---
Write-Host "Running quick setup..." -ForegroundColor Green
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
# Brain -- $name
Last refreshed: $nowIso

## L0 -- Identity
- Name: $name
- GitHub: $githubPersonal$(if ($githubWork -ne $githubPersonal) { " (personal), $githubWork (work)" } else { "" })
- Principles:
$principlesBlock
## L1 -- Active Work

| Project | Status | Branch | Notes |
|---------|--------|--------|-------|
| (none yet) | -- | -- | Run refresh.ps1 after some sessions |

### Decisions (recent)
- (none yet -- decisions are captured during sessions)

## Recently Learned
(empty -- entries appear as you work)

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
            Set-Content -Path $dst -Value "# $($tmpl.Key -replace '\.md$','' -replace '-',' ')`n`n(empty -- will be populated as you work)`n" -Encoding UTF8
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
$instructionsPath = Join-Path $HOME '.github' 'copilot-instructions.md'
$copilotDir = Join-Path $HOME '.github'
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
    $sessionDb = Join-Path $HOME '.copilot' 'session-store.db'
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
                        Write-Host "  [OK] Harvest complete!" -ForegroundColor Green
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
            Write-Host "  Skipped -- run 'python engine/harvest.py' later to populate." -ForegroundColor DarkGray
        }
    } else {
        Write-Host "  No session_store found (will index after first Copilot CLI sessions)" -ForegroundColor DarkGray
    }
} else {
    Write-Host "  Python not found -- skip indexing (run 'python engine/indexer.py' later)" -ForegroundColor Yellow
}

# --- Step 10: Open Obsidian ---
$obsidianConfigPath = Join-Path $env:APPDATA 'obsidian' 'obsidian.json'
if (Test-Path $obsidianConfigPath) {
    # Obsidian is installed -- check if vault is registered
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
    Write-Host "  Obsidian not detected -- skipping vault registration." -ForegroundColor Yellow
    Write-Host "  Install Obsidian from https://obsidian.md for visual wiki browsing." -ForegroundColor DarkGray
    Write-Host "  After installing, see docs/obsidian-setup.md for manual setup." -ForegroundColor DarkGray
}

# --- Step 11: Set up automatic maintenance ---
Write-Host ""
$setupMaintenance = Read-Host "Set up automatic maintenance? (Y/n)"
if ($setupMaintenance -ne 'n' -and $setupMaintenance -ne 'N') {
    Write-Host "  Frequency options:" -ForegroundColor Cyan
    Write-Host "    1. hourly        -- refresh every hour (recommended)" -ForegroundColor White
    Write-Host "    2. every4hours   -- refresh every 4 hours" -ForegroundColor White
    Write-Host "    3. daily         -- refresh once a day" -ForegroundColor White
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
        Write-Host "  setup-scheduler.ps1 not found -- skip scheduler setup" -ForegroundColor Yellow
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
Write-Host "  1. Start using Copilot CLI -- your sessions will be mined automatically"
Write-Host "  2. Run 'python engine/harvest.py' to extract decisions & patterns"
Write-Host "  3. Run 'scripts/refresh.ps1' periodically to update brain.md"
Write-Host "  4. Run 'scripts/lint.ps1' to check wiki health"
Write-Host "  5. Run 'python engine/indexer.py' to reindex ChromaDB"
Write-Host "  6. Run 'scripts/maintenance.ps1' for full maintenance cycle"
Write-Host ""
