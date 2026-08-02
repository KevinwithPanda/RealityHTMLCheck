#!/usr/bin/env python3
"""Install or update the bundled RealityCheck skill in the user's Codex home."""

from __future__ import annotations

import argparse
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SOURCE = REPOSITORY_ROOT / "realitycheck"


def destination_root() -> Path:
    configured = os.environ.get("CODEX_HOME")
    return Path(configured).expanduser() if configured else Path.home() / ".codex"


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Install or update the RealityCheck Codex skill."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print the destination without changing files."
    )
    args = parser.parse_args()

    destination = destination_root().resolve() / "skills" / "realitycheck"
    print(f"source:      {SOURCE}")
    print(f"destination: {destination}")
    if args.dry_run:
        print("status:      dry run; no files changed")
        return 0

    destination.parent.mkdir(parents=True, exist_ok=True)
    backup: Path | None = None
    if destination.exists():
        timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = destination.with_name(f"realitycheck.backup-{timestamp}")
        if backup.exists():
            raise RuntimeError(f"backup path already exists: {backup}")
        destination.replace(backup)
        print(f"backup:      {backup}")

    try:
        shutil.copytree(
            SOURCE,
            destination,
            ignore=shutil.ignore_patterns("__pycache__", "*.pyc", "*.pyo"),
        )
    except Exception:
        if destination.exists():
            shutil.rmtree(destination)
        if backup is not None and backup.exists():
            backup.replace(destination)
        raise

    print("status:      installed")
    print("next:        reload Codex, then say: Use $realitycheck on this app.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
