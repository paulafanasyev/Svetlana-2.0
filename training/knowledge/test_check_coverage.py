import json
import tempfile
import unittest
from pathlib import Path

from training.knowledge.check_coverage import main


class CoverageCheckerContractTest(unittest.TestCase):
    def make_fixture(self, root: Path, broken: bool = False) -> None:
        (root / "training/knowledge").mkdir(parents=True)
        (root / "training/datasets").mkdir(parents=True)
        (root / "training/evaluation").mkdir(parents=True)
        (root / "src/services").mkdir(parents=True)

        skeleton = {
            "schema_version": "1.0",
            "node_schema": {
                "required": ["id", "parent", "title", "type", "stability",
                              "training_target", "eval_target", "runtime_dependency", "status"]
            },
            "nodes": [{
                "id": "00.core",
                "parent": None,
                "title": "Core",
                "type": "domain",
                "stability": "stable",
                "training_target": "behavior",
                "eval_target": "heldout_core",
                "runtime_dependency": "none",
                "status": "PENDING"
            }]
        }
        skills = {
            "schema_version": "1.0",
            "skills": [{
                "skill_id": "core.skill",
                "node_ids": [] if broken else ["00.core"]
            }]
        }
        contract = {
            "schema_version": "1.0",
            "source_of_truth": {
                "skeleton": "training/knowledge/SVETLANA_KNOWLEDGE_SKELETON.json",
                "skills": "training/knowledge/SVETLANA_SKILL_MANIFESTS_V1.json",
                "training_manifest": "training/datasets/manifest_v2.json",
                "tool_registry": "src/services/ToolRegistry.ts",
                "real_tools": "src/services/RealTools.ts",
                "policy_engine": "src/services/PolicyEngine.ts",
                "verification": "src/services/Verification.ts"
            },
            "links": {"node_to_skill": {"00.core": ["core.skill"]}},
            "runtime_rules": {"none": "NOT_REQUIRED"}
        }
        manifest = {
            "train": [{"path": "training/datasets/train.jsonl"}],
            "eval": [{"path": "training/evaluation/eval.jsonl"}]
        }
        for path, data in [
            ("training/knowledge/SVETLANA_KNOWLEDGE_SKELETON.json", skeleton),
            ("training/knowledge/SVETLANA_SKILL_MANIFESTS_V1.json", skills),
            ("training/knowledge/SVETLANA_COVERAGE_CONTRACT.json", contract),
            ("training/datasets/manifest_v2.json", manifest),
        ]:
            (root / path).write_text(json.dumps(data), encoding="utf-8")
        (root / "training/datasets/train.jsonl").write_text(
            '{"id":"train-1","node_id":"00.core","messages":[{"role":"user","content":"x"}]}\n',
            encoding="utf-8")
        (root / "training/evaluation/eval.jsonl").write_text(
            '{"id":"eval-1","node_id":"00.core","messages":[{"role":"user","content":"x"}]}\n',
            encoding="utf-8")
        (root / "src/services/ToolRegistry.ts").write_text(
            "export const x={id:'open_app'}\n", encoding="utf-8")
        for name in ("RealTools.ts", "PolicyEngine.ts", "Verification.ts"):
            (root / "src/services" / name).write_text("export const x={};\n", encoding="utf-8")


    def test_valid_graph_passes(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self.make_fixture(root)
            self.assertEqual(main(root), 0)

    def test_broken_skill_link_fails(self):
        with tempfile.TemporaryDirectory() as td:
            root = Path(td)
            self.make_fixture(root, broken=True)
            self.assertEqual(main(root), 1)


if __name__ == "__main__":
    unittest.main()
