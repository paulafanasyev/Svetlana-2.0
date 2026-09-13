# Svetlana multimodal training

Target base: Google Gemma 4 E2B instruction-tuned (`google/gemma-4-E2B-it`).

Target deployment: Google LiteRT-LM.

Training environment: Google Colab / Google GPU.

Kaggle is not part of the training path.

## Required modalities from the first training generation

- image and screenshots
- audio and speech
- documents and PDFs, represented through supported native media processing
- video / temporal media
- mixed text + media inputs
- multimodal tool observations

The current `train_svetlana_smoke.py` is text-only and must not be used as the final multimodal trainer.

Google's current Gemma 4 documentation confirms multimodal text/image/audio support for E2B and native Transformers processing through `AutoProcessor` and `AutoModelForMultimodalLM`. Google's Gemma 4 video guide also documents video inputs. For prompt ordering, image content is placed before text and audio after text.

The repository contains a multimodal curriculum contract and a preflight contract. Real media files, provenance records, normalized native messages, and modality-specific evaluation cases are still required before GPU training starts.

## Native training direction

The final trainer must preserve media parts instead of flattening them into text. The preflight layer must verify curriculum coverage first, then verify the actual media assets and provenance, then exercise the native processor on a real multimodal sample. Only after that may the training implementation be enabled.

## Acceptance gates before training

1. real media assets exist;
2. every asset has source/license/hash metadata;
3. multimodal records convert to native Gemma 4 messages without dropping media;
4. train/eval leakage test passes;
5. native multimodal processor/trainer imports and preflight pass;
6. one small multimodal batch reaches the processor successfully;
7. only then run the first Google Colab GPU training job.

## Deployment evidence

A successful LoRA adapter is not evidence of LiteRT-LM conversion or Android inference. Conversion and on-device execution require separate real artifacts and runtime evidence.
