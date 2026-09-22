"""Validate and report skeleton -> skill -> tool -> train -> eval -> runtime coverage.

This is a deterministic structural gate. It deliberately cannot mark runtime-dependent
capabilities VERIFIED from static repository files alone.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for no, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
        if not line.strip():
            continue
        value = json.loads(line)
        if not isinstance(value, dict):
            raise ValueError(f"{path}:{no}: record must be object")
        rows.append(value)
    return rows


def read_tool_ids(path: Path) -> list[str]:
    text = path.read_text(encoding="utf-8")
    return re.findall(r"\bid:\s*['\"]([a-zA-Z0-9_.-]+)['\"]", text)


def descendants(nodes: dict[str, dict[str, Any]], node_id: str) -> set[str]:
    result = {node_id}
    changed = True
    while changed:
        changed = False
        for nid, node in nodes.items():
            if node.get("parent") in result and nid not in result:
                result.add(nid)
                changed = True
    return result


def main(root: Path) -> int:
    skeleton = load_json(root / "training/knowledge/SVETLANA_KNOWLEDGE_SKELETON.json")
    skills = load_json(root / "training/knowledge/SVETLANA_SKILL_MANIFESTS_V1.json")
    manifest = load_json(root / "training/datasets/manifest_v2.json")
    contract = load_json(root / "training/knowledge/SVETLANA_COVERAGE_CONTRACT.json")
    tool_contracts = load_json(root / "training/knowledge/SVETLANA_TOOL_CONTRACTS_V1.json")

    nodes_list = skeleton.get("nodes", [])
    node_map = {n["id"]: n for n in nodes_list}
    errors: list[str] = []
    for node in nodes_list:
        for key in skeleton["node_schema"]["required"]:
            if key not in node:
                errors.append(f"node {node.get('id')}: missing {key}")
        parent = node.get("parent")
        if parent is not None and parent not in node_map:
            errors.append(f"node {node['id']}: unknown parent {parent}")

    skill_map = {s["skill_id"]: s for s in skills.get("skills", [])}
    tool_contract_map = {c["contract_id"]: c for c in tool_contracts.get("contracts", [])}
    if len(tool_contract_map) != len(tool_contracts.get("contracts", [])):
        errors.append("tool contracts: duplicate contract_id")
    for contract_id, tc in tool_contract_map.items():
        for required_key in ("skill_ids", "action", "risk_level", "input_schema", "confirmation", "verification"):
            if required_key not in tc:
                errors.append(f"tool contract {contract_id}: missing {required_key}")
    for skill_id, skill in skill_map.items():
        contract_ids = skill.get("tool_contract_ids", [])
        if not contract_ids:
            errors.append(f"skill {skill_id}: has no tool_contract_ids")
        for contract_id in contract_ids:
            tc = tool_contract_map.get(contract_id)
            if tc is None:
                errors.append(f"skill {skill_id}: unknown tool contract {contract_id}")
            elif skill_id not in tc.get("skill_ids", []):
                errors.append(f"tool contract {contract_id}: missing skill {skill_id}")
        for node_id in skill.get("node_ids", []):
            if node_id not in node_map:
                errors.append(f"skill {skill_id}: unknown node {node_id}")
    contract_links = contract.get("links", {}).get("node_to_skill", {})
    for node_id in node_map:
        if node_id not in contract_links or not contract_links[node_id]:
            errors.append(f"contract: node {node_id} has no skill link")
    for node_id, linked_skills in contract_links.items():
        if node_id not in node_map:
            errors.append(f"contract: unknown node {node_id}")
        for skill_id in linked_skills:
            if skill_id not in skill_map:
                errors.append(f"contract: node {node_id} references unknown skill {skill_id}")
            elif node_id not in skill_map[skill_id].get("node_ids", []):
                errors.append(f"contract: skill {skill_id} missing node {node_id}")
    linked_by_skill = {node_id for skill in skill_map.values() for node_id in skill.get("node_ids", [])}
    for node_id in node_map:
        if node_id not in linked_by_skill:
            errors.append(f"skill map: node {node_id} is not assigned to any skill")

    train_rows: list[dict[str, Any]] = []
    eval_rows: list[dict[str, Any]] = []
    for item in manifest.get("train", []):
        train_rows.extend(load_jsonl(root / item["path"]))
    for item in manifest.get("eval", []):
        eval_rows.extend(load_jsonl(root / item["path"]))

    train_counts: dict[str, int] = {}
    eval_counts: dict[str, int] = {}
    for row in train_rows:
        nid = row.get("node_id")
        if nid:
            train_counts[nid] = train_counts.get(nid, 0) + 1
    for row in eval_rows:
        nid = row.get("node_id")
        if nid:
            eval_counts[nid] = eval_counts.get(nid, 0) + 1

    if any(nid not in node_map for nid in train_counts):
        errors.extend(f"training: unknown node_id {nid}" for nid in train_counts if nid not in node_map)
    if any(nid not in node_map for nid in eval_counts):
        errors.extend(f"eval: unknown node_id {nid}" for nid in eval_counts if nid not in node_map)

    tool_registry = read_tool_ids(root / "src/services/ToolRegistry.ts")
    real_tools = read_tool_ids(root / "src/services/RealTools.ts")
    real_tool_set = set(real_tools)
    contract_runtime_ids = set()
    for contract_id, tc in tool_contract_map.items():
        runtime_tool_id = tc.get("runtime_tool_id")
        if runtime_tool_id:
            contract_runtime_ids.add(runtime_tool_id)
            if runtime_tool_id not in real_tool_set:
                errors.append(f"tool contract {contract_id}: runtime_tool_id {runtime_tool_id} is not present in RealTools.ts")
    for tool_id in real_tools:
        if tool_id not in contract_runtime_ids:
            errors.append(f"RealTools.ts: tool {tool_id} has no tool contract")
    for skill_id, skill in skill_map.items():
        for tool_id in skill.get("tool_ids", []):
            if tool_id not in real_tool_set:
                errors.append(f"skill {skill_id}: concrete tool {tool_id} is not present in RealTools.ts")
    required_runtime_sources = {
        "tool_registry": (root / contract["source_of_truth"]["tool_registry"]).is_file(),
        "real_tools": (root / contract["source_of_truth"]["real_tools"]).is_file(),
        "policy_engine": (root / contract["source_of_truth"]["policy_engine"]).is_file(),
        "verification": (root / contract["source_of_truth"]["verification"]).is_file(),
    }

    report: list[dict[str, Any]] = []
    for node_id, node in node_map.items():
        covered = descendants(node_map, node_id)
        direct_train = train_counts.get(node_id, 0)
        direct_eval = eval_counts.get(node_id, 0)
        inherited_train = sum(train_counts.get(child, 0) for child in covered if child != node_id)
        inherited_eval = sum(eval_counts.get(child, 0) for child in covered if child != node_id)
        knowledge_links = 0
        for p in (
            root / "training/knowledge/SVETLANA_KNOWLEDGE_PACK_V1.json",
            root / "training/knowledge/SVETLANA_KNOWLEDGE_PACK_V2.json",
            root / "training/knowledge/SVETLANA_DOCUMENT_INTELLIGENCE_PACK_V1.json",
        ):
            if p.is_file():
                data = load_json(p)
                if any(x.get("node_id") == node_id for x in data.get("entries", [])):
                    knowledge_links += 1

        runtime_dep = str(node.get("runtime_dependency", "mixed"))
        runtime_status = "NOT_REQUIRED" if runtime_dep == "none" else contract.get("runtime_rules", {}).get(
            runtime_dep.split("|")[0], "NOT_PROVEN"
        )
        skill_links = contract.get("links", {}).get("node_to_skill", {}).get(node_id, [])
        tool_links = sorted({tool_id for skill_id in skill_links for tool_id in skill_map.get(skill_id, {}).get("tool_ids", [])})
        training_total = direct_train + inherited_train
        eval_total = direct_eval + inherited_eval
        report.append({
            "node_id": node_id,
            "title": node.get("title"),
            "skills": skill_links,
            "tools": tool_links,
            "knowledge_artifacts": knowledge_links,
            "training_examples": training_total,
            "heldout_examples": eval_total,
            "runtime_dependency": runtime_dep,
            "runtime_status": runtime_status,
            "coverage_status": "NOT_PROVEN" if training_total and eval_total else "PENDING",
        })

    summary = {
        "schema_version": contract.get("schema_version"),
        "nodes": len(report),
        "nodes_with_training": sum(x["training_examples"] > 0 for x in report),
        "nodes_with_heldout": sum(x["heldout_examples"] > 0 for x in report),
        "nodes_with_skills": sum(bool(x["skills"]) for x in report),
        "nodes_with_knowledge_artifact": sum(x["knowledge_artifacts"] > 0 for x in report),
        "tool_registry_ids_detected": len(tool_registry),
        "real_tool_ids_detected": len(real_tools),
        "tool_contract_ids_detected": len(tool_contract_map),
        "runtime_sources_present": required_runtime_sources,
        "train_records_scanned": len(train_rows),
        "eval_records_scanned": len(eval_rows),
        "errors": errors,
        "result": "VERIFIED" if not errors else "NOT_PROVEN",
        "runtime_capability_result": "NOT_PROVEN",
    }
    (root / "training/knowledge/SVETLANA_COVERAGE_REPORT.json").write_text(
        json.dumps({"summary": summary, "nodes": report}, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    md = [
        "# Svetlana 2.0 — Automatic Coverage Report",
        "",
        f"Result: **{summary['result']}**",
        "",
        f"- Skeleton nodes: {summary['nodes']}",
        f"- Nodes with training examples (direct+descendant): {summary['nodes_with_training']}",
        f"- Nodes with held-out eval (direct+descendant): {summary['nodes_with_heldout']}",
        f"- Nodes linked to skills: {summary['nodes_with_skills']}",
        f"- Nodes linked to knowledge artifacts: {summary['nodes_with_knowledge_artifact']}",
        f"- ToolRegistry IDs detected: {summary['tool_registry_ids_detected']}",
        f"- RealTools IDs detected: {summary['real_tool_ids_detected']}",
        f"- Tool contract IDs detected: {summary['tool_contract_ids_detected']}",
        f"- Train records scanned: {summary['train_records_scanned']}",
        f"- Eval records scanned: {summary['eval_records_scanned']}",
        "",
        "## Runtime rule",
        "Runtime-dependent nodes remain **NOT PROVEN** until real execution evidence exists.",
        "",
        "| Node | Skills | Tools | Knowledge | Train | Held-out | Runtime | Status |",
        "|---|---|---|---:|---:|---:|---|---|",
    ]
    for x in report:
        md.append(
            f"| {x['node_id']} | {', '.join(x['skills']) or '-'} | {', '.join(x['tools']) or '-'} | "
            f"{x['knowledge_artifacts']} | {x['training_examples']} | {x['heldout_examples']} | "
            f"{x['runtime_status']} | {x['coverage_status']} |"
        )
    md += ["", "## Errors"]
    md += [f"- {e}" for e in errors] or ["- None"]
    (root / "training/knowledge/SVETLANA_COVERAGE_REPORT.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0 if not errors else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", type=Path, default=Path(__file__).resolve().parents[2])
    raise SystemExit(main(parser.parse_args().root))
