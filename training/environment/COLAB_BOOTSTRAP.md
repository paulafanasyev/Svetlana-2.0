# Google Colab GPU bootstrap

This is the intended execution environment for the first real `text_smoke` run. Kaggle is not part of this path.

## Fresh runtime

Use a new Google Colab runtime with a Tesla T4 15 GB or better. Do not run training from the default Manus sandbox.

```bash
!git clone --branch chore/training-evidence-gates https://github.com/paulafanasyev/Svetlana-2.0.git
%cd Svetlana-2.0
!python -m pip install --upgrade pip
!python -m pip install -r training/environment/requirements-colab-gpu.txt
```

The branch must be replaced with the published commit SHA after review; do not train from a moving branch name.

## Environment gate

Before baseline or training, run:

```bash
!python - <<'PY'
import importlib
import torch
for name in ['transformers', 'trl', 'unsloth', 'datasets', 'accelerate', 'peft']:
    importlib.import_module(name)
assert torch.cuda.is_available(), 'CUDA is required'
print('CUDA=', torch.version.cuda)
print('GPU=', torch.cuda.get_device_name(0))
print('VRAM_GB=', round(torch.cuda.get_device_properties(0).total_memory / 1024**3, 2))
PY
```

A failed import, failed CUDA check, or model-loading error is a hard failure. Do not label the run as baseline or training.

## Evidence rule

Record the exact commit SHA, pip freeze, GPU, CUDA, model revision, dataset hash and all output artifacts. The repository validator only proves assets; it does not prove that this Colab environment passed.
