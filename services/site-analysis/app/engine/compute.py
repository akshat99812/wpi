"""Pure numeric core — arrays in, arrays out, NO IO. Kept as a clean function
boundary so a future Rust/PyO3 kernel can slot in for the heavy raster reductions
(RUNBOOK_v3 §7). Intentionally empty in Phase 2; populated during the Phase 3 port.
"""
from __future__ import annotations
