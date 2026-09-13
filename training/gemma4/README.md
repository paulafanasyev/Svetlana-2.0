# Svetlana multimodal training: Google Gemma 4 E2B + Colab

The target training model is `google/gemma-4-E2B-it`. The training environment is Google Colab / Google GPU. Kaggle is not part of the training path.

## Current state

The repository is in preparation phase. The existing `train_svetlana_smoke.py` is text-only and is **not** the final trainer. GPU training is intentionally blocked until the native multimodal preflight is ready and real media assets have complete provenance metadata.

## Required first-generation modalities

- image and screenshots
- audio and speech
- document/PDF inputs represented through supported native media processing
- video / temporal media
- mixed text + media
- multimodal tool observations

Google's current Gemma 4 documentation confirms multimodal text/image/audio capability for E2B and documents native Transformers processing through `AutoProcessor` and `AutoModelForMultimodalLM`. Image content should precede text; audio follows text in the multimodal prompt format. Video input is also documented for Gemma 4.

## Acceptance gates

1. real media assets exist;
2. every asset has source/license/hash metadata;
3. records convert to native Gemma 4 messages without dropping media;
4. train/eval leakage check passes;
5. native multimodal processor/trainer import and preflight pass;
6. one small multimodal batch reaches the processor successfully;
7. only then may the first Google Colab GPU training run start.

## Deployment target

LiteRT-LM remains the target on-device runtime. A successful training adapter is **not** evidence of LiteRT-LM conversion or Android inference; both require separate runtime evidence.

## Evidence rule

- VERIFIED: repository code/config or successful CI validation.
- NOT PROVEN: GPU training, adapter quality, LiteRT-LM conversion, or Android inference until real logs/artifacts exist.
- Never commit trained model weights into Git.
