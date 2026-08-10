#!/usr/bin/env python3
"""Install or update the bundled RealityCheck skill in the user's Codex home."""

from __future__ import annotations

import argparse
import hashlib
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SOURCE = REPOSITORY_ROOT / "realitycheck"
IGNORED_NAMES = {"__pycache__"}


def destination_root() -> Path:
    configured = os.environ.get("CODEX_HOME")
    return Path(configured).expanduser() if configured else Path.home() / ".codex"


def tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for path in sorted(root.rglob("*")):
        if not path.is_file() or any(part in IGNORED_NAMES for part in path.parts):
            continue
        if path.suffix in {".pyc", ".pyo"}:
            continue
        relative = path.relative_to(root).as_posix().encode("utf-8")
        digest.update(len(relative).to_bytes(4, "big"))
        digest.update(relative)
        digest.update(path.read_bytes())
    return digest.hexdigest()


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Install or update the RealityCheck Codex skill."
    )
    parser.add_argument(
        "--dry-run", action="store_true", help="Print the destination without changing files."
    )
    parser.add_argument(
        "--status", action="store_true", help="Check whether the installed skill matches this repository."
    )
    args = parser.parse_args()

    destination = destination_root().resolve() / "skills" / "realitycheck"
    print(f"source:      {SOURCE}")
    print(f"destination: {destination}")
    if args.status:
        if not destination.exists():
            print("status:      not installed")
            return 1
        if tree_digest(SOURCE) != tree_digest(destination):
            print("status:      installed, but different from this repository")
            return 1
        print("status:      installed and current")
        return 0
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
    print("verification: installed files match this repository")
    print("next:        reload Codex, then say: Use $realitycheck on this app.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
