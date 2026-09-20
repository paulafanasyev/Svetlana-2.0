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


def _sha256_paths(paths: Iterable[Path], *, root: Path | None = None) -> str:
    digest = hashlib.sha256()
    normalized_root = root.resolve() if root is not None else None
    normalized_paths = []
    for path in paths:
        candidate = Path(path)
        if normalized_root is not None and not candidate.is_absolute():
            candidate = normalized_root / candidate
        normalized_paths.append(candidate.resolve())
    for path in sorted(normalized_paths, key=lambda item: item.as_posix()):
        if normalized_root is not None:
            try:
                label = path.relative_to(normalized_root).as_posix()
            except ValueError as exc:
                raise ValueError(
                    f"Evidence path {path} is outside repository root {normalized_root}"
                ) from exc
        else:
            label = path.as_posix()
        digest.update(label.encode("utf-8"))
        digest.update(_sha256_file(path).encode("ascii"))
    return digest.hexdigest()


def _git_commit(root: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "-C", str(root), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
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
    root = root.resolve()
    adapter_dir = (root / adapter_dir if not adapter_dir.is_absolute() else adapter_dir).resolve()
    try:
        adapter_dir.relative_to(root)
    except ValueError as exc:
        raise ValueError(
            f"Adapter directory {adapter_dir} must be inside repository root {root}"
        ) from exc

    adapter_files = sorted(
        (path for path in adapter_dir.rglob("*") if path.is_file()),
        key=lambda path: path.as_posix(),
    )
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
        "dataset_sha256": _sha256_paths(dataset_paths, root=root),
        "adapter_sha256": _sha256_paths(adapter_files, root=root),
        "adapter_files": [str(path.relative_to(root).as_posix()) for path in adapter_files],
    }


def write_evidence(path: Path, **kwargs: Any) -> dict[str, Any]:
    evidence = build_evidence(**kwargs)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(evidence, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return evidence
