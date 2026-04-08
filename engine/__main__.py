"""Allow running: python -m engine"""
import sys
from pathlib import Path

# Ensure engine dir is on path for standalone use
sys.path.insert(0, str(Path(__file__).parent))

from mcp_server import mcp  # noqa: E402

mcp.run(transport="stdio")
