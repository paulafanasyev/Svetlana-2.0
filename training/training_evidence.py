"""Evidence artifact helpers for reproducible Svetlana training runs."""
from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from importlib.metadata import PackageNotFoundError, version
from pathlib import Path
from typing import Any, Iterable


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _sha256_paths(paths: Iterable[Path]) -> str:
    digest = hashlib.sha256()
    for path in sorted(paths):
        digest.update(str(path).encode())
        digest.update(_sha256_file(path).encode())
    return digest.hexdigest()


def _git_commit(root: Path) -> str:
    try:
        return subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True, stderr=subprocess.DEVNULL).strip()
    except (OSError, subprocess.CalledProcessError):
        return "unknown"


def _package_versions() -> dict[str, str]:
    packages = ["torch", "transformers", "trl", "unsloth", "datasets", "accelerate", "peft"]
    result = {}
    for package in packages:
        try:
            result[package] = version(package)
        except PackageNotFoundError:
            result[package] = "not-installed"
    return result


def build_evidence(
    root: Path,
    adapter_dir: Path,
    dataset_paths: Iterable[Path],
    config: dict[str, Any],
    hardware: dict[str, Any],
    model: str = "google/gemma-4-E2B-it",
) -> dict[str, Any]:
    adapter_files = [p for p in adapter_dir.rglob("*") if p.is_file()]
    if not adapter_files:
        raise ValueError("adapter directory is empty; refusing to create training evidence")
    return {
        "schema_version": "1.0",
        "git_commit": _git_commit(root),
        "python": sys.version,
        "packages": _package_versions(),
        "model": model,
        "hardware": hardware,
        "config": config,
        "dataset_sha256": _sha256_paths(dataset_paths),
        "adapter_sha256": _sha256_paths(adapter_files),
        "adapter_files": [str(p.relative_to(root)) for p in sorted(adapter_files)],
    }


def write_evidence(path: Path, **kwargs: Any) -> dict[str, Any]:
    evidence = build_evidence(**kwargs)
    path.write_text(json.dumps(evidence, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    return evidence
