#!/bin/bash
# setup-cron.sh — Configure cron jobs for wiki-recall maintenance (Mac/Linux)
#
# Usage:
#   ./setup-cron.sh [hourly|daily] [--uninstall]
#
# Examples:
#   ./setup-cron.sh hourly        # Run maintenance every hour
#   ./setup-cron.sh daily         # Run maintenance once daily at 11 PM
#   ./setup-cron.sh --uninstall   # Remove all wiki-recall cron entries

set -euo pipefail

FREQUENCY="${1:-hourly}"
UNINSTALL=false
GRAIN_DIR="$HOME/.grain"
SCRIPTS_DIR="$(cd "$(dirname "$0")" && pwd)"
CRON_MARKER="# wiki-recall-auto"
LOG_DIR="$GRAIN_DIR/logs"

# Parse args
for arg in "$@"; do
    case "$arg" in
        --uninstall) UNINSTALL=true ;;
        hourly|daily) FREQUENCY="$arg" ;;
        *) echo "Unknown argument: $arg"; echo "Usage: $0 [hourly|daily] [--uninstall]"; exit 1 ;;
    esac
done

# --- Uninstall ---
if [ "$UNINSTALL" = true ]; then
    echo "Removing wiki-recall cron entries..."
    crontab -l 2>/dev/null | grep -v "$CRON_MARKER" | crontab - 2>/dev/null || true
    echo "Done. All wiki-recall cron entries removed."
    exit 0
fi

# --- Validate ---
if [ ! -d "$GRAIN_DIR" ]; then
    echo "ERROR: ~/.grain/ not found. Run setup first."
    exit 1
fi

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Find Python
PYTHON_CMD=""
if command -v python3 &>/dev/null; then
    PYTHON_CMD="python3"
elif command -v python &>/dev/null; then
    PYTHON_CMD="python"
fi

# Find PowerShell (pwsh on Mac/Linux)
PWSH_CMD=""
if command -v pwsh &>/dev/null; then
    PWSH_CMD="pwsh"
fi

# --- Build cron entries ---
CRON_ENTRIES=""
DATE_FMT='$(date +\%Y-\%m-\%d)'

if [ "$FREQUENCY" = "hourly" ]; then
    # Maintenance: every hour at :00
    if [ -n "$PWSH_CMD" ]; then
        CRON_ENTRIES+="0 * * * * cd $SCRIPTS_DIR && $PWSH_CMD -ExecutionPolicy Bypass -File maintenance.ps1 >> $LOG_DIR/cron.log 2>&1 $CRON_MARKER"
    elif [ -n "$PYTHON_CMD" ]; then
        CRON_ENTRIES+="0 * * * * cd $GRAIN_DIR && $PYTHON_CMD engine/indexer.py --incremental >> $LOG_DIR/cron.log 2>&1 $CRON_MARKER"
    fi
    CRON_ENTRIES+=$'\n'

    # Backup: every hour at :30
    if [ -n "$PWSH_CMD" ]; then
        CRON_ENTRIES+="30 * * * * cd $SCRIPTS_DIR && $PWSH_CMD -ExecutionPolicy Bypass -File backup.ps1 -Layer local >> $LOG_DIR/cron.log 2>&1 $CRON_MARKER"
    else
        CRON_ENTRIES+="30 * * * * mkdir -p $HOME/wiki-recall-backup/$DATE_FMT && rsync -a --exclude='chromadb' --exclude='__pycache__' --exclude='node_modules' --exclude='.obsidian' --exclude='.git' $GRAIN_DIR/ $HOME/wiki-recall-backup/$DATE_FMT/ >> $LOG_DIR/cron.log 2>&1 $CRON_MARKER"
    fi
    CRON_ENTRIES+=$'\n'

    # Nightly: 11 PM
    if [ -n "$PWSH_CMD" ]; then
        CRON_ENTRIES+="0 23 * * * cd $SCRIPTS_DIR && $PWSH_CMD -ExecutionPolicy Bypass -File maintenance.ps1 >> $LOG_DIR/cron-nightly.log 2>&1 $CRON_MARKER"
    elif [ -n "$PYTHON_CMD" ]; then
        CRON_ENTRIES+="0 23 * * * cd $GRAIN_DIR && $PYTHON_CMD engine/indexer.py >> $LOG_DIR/cron-nightly.log 2>&1 $CRON_MARKER"
    fi

elif [ "$FREQUENCY" = "daily" ]; then
    # Maintenance: daily at 11 PM
    if [ -n "$PWSH_CMD" ]; then
        CRON_ENTRIES+="0 23 * * * cd $SCRIPTS_DIR && $PWSH_CMD -ExecutionPolicy Bypass -File maintenance.ps1 >> $LOG_DIR/cron.log 2>&1 $CRON_MARKER"
    elif [ -n "$PYTHON_CMD" ]; then
        CRON_ENTRIES+="0 23 * * * cd $GRAIN_DIR && $PYTHON_CMD engine/indexer.py >> $LOG_DIR/cron.log 2>&1 $CRON_MARKER"
    fi
    CRON_ENTRIES+=$'\n'

    # Backup: daily at 11:30 PM
    if [ -n "$PWSH_CMD" ]; then
        CRON_ENTRIES+="30 23 * * * cd $SCRIPTS_DIR && $PWSH_CMD -ExecutionPolicy Bypass -File backup.ps1 -Layer local >> $LOG_DIR/cron.log 2>&1 $CRON_MARKER"
    else
        CRON_ENTRIES+="30 23 * * * mkdir -p $HOME/wiki-recall-backup/$DATE_FMT && rsync -a --exclude='chromadb' --exclude='__pycache__' --exclude='node_modules' --exclude='.obsidian' --exclude='.git' $GRAIN_DIR/ $HOME/wiki-recall-backup/$DATE_FMT/ >> $LOG_DIR/cron.log 2>&1 $CRON_MARKER"
    fi
fi

if [ -z "$CRON_ENTRIES" ]; then
    echo "ERROR: No suitable runtime found (need pwsh or python3)."
    exit 1
fi

# --- Install: remove old entries, add new ---
echo "Installing wiki-recall cron entries (frequency: $FREQUENCY)..."

# Get existing crontab, strip old wiki-recall entries
EXISTING_CRON=$(crontab -l 2>/dev/null | grep -v "$CRON_MARKER" || true)

# Write combined crontab
echo "$EXISTING_CRON" | cat - <(echo "$CRON_ENTRIES") | crontab -

echo ""
echo "Cron entries installed:"
crontab -l 2>/dev/null | grep "$CRON_MARKER" | while read -r line; do
    echo "  $line"
done

echo ""
echo "To remove: $0 --uninstall"
echo "To view:   crontab -l | grep wiki-recall"
echo ""
