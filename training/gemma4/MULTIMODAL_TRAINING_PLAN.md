# Svetlana multimodal training

Target base: Google Gemma 4 E2B instruction-tuned.

Target deployment: Google LiteRT-LM.

Training environment: Google Colab / Google GPU.

Required modalities from the first training generation:
- image and screenshots
- audio and speech
- documents and PDFs
- video / temporal media
- mixed text + media inputs
- multimodal tool observations

The current `train_svetlana_smoke.py` is text-only and must not be used as the final multimodal trainer.

The final trainer must use Gemma 4's native multimodal processor/data-collator path and preserve media parts in the conversation format. Media must be ordered before text where required by the Gemma 4 multimodal format.

The repository now contains a multimodal curriculum contract. Real media files, provenance records, normalized messages, and modality-specific evaluation cases are still required before GPU training starts.

Google/Unsloth currently document Gemma 4 multimodal fine-tuning for E2B/E4B with a vision-capable training path and audio support. The project must pin tested versions of transformers, TRL, Unsloth and related packages before the first run.

Acceptance gates before training:
1. real media assets exist;
2. every asset has source/license/hash metadata;
3. multimodal records convert to native Gemma 4 messages;
4. train/eval leakage test passes;
5. multimodal trainer imports and compiles;
6. one small preflight batch reaches the processor without dropping media;
7. only then run the first GPU training job.
