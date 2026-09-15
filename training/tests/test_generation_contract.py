import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
GENERATOR = ROOT / "training/gemma4/generate_predictions.py"
TRAINER = ROOT / "training/gemma4/train_svetlana_smoke.py"


class GenerationContractTests(unittest.TestCase):
    def test_generator_uses_attention_mask_and_model_device(self):
        source = GENERATOR.read_text(encoding="utf-8")
        self.assertIn("return_dict=True", source)
        self.assertIn("attention_mask", source)
        self.assertIn("to(model.device)", source)
        self.assertNotIn('.to("cuda")', source)
        self.assertIn('"--metadata-output"', source)

    def test_generator_imports_unsloth_before_torch(self):
        source = GENERATOR.read_text(encoding="utf-8")
        self.assertLess(source.index("from unsloth import FastLanguageModel"), source.index("import torch"))

    def test_trainer_resolves_all_manifest_train_files(self):
        source = TRAINER.read_text(encoding="utf-8")
        self.assertIn('MANIFEST["train"]', source)
        self.assertIn('DATA_FILES = [ROOT.parent / item["path"] for item in MANIFEST["train"]]', source)


if __name__ == "__main__":
    unittest.main()
