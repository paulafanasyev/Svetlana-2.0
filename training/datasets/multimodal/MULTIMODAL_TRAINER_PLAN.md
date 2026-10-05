# Native multimodal trainer plan

## Verified upstream capability

Gemma 4 E2B is exposed by Transformers as `AutoModelForMultimodalLM` with `AutoProcessor`. The model family supports image and video inputs, and E2B/E4B support native audio inputs. Current Hugging Face TRL documentation supports SFT of VLM datasets with image columns and PEFT adapters.

## Svetlana implementation requirements

The trainer must:

1. load `google/gemma-4-E2B-it` with `AutoModelForMultimodalLM` and `AutoProcessor`;
2. consume repository-local media references rather than replacing media with descriptions;
3. preserve multimodal content blocks through the chat template;
4. train with LoRA/PEFT while keeping vision/audio components frozen unless an experiment explicitly changes that policy;
5. use `max_length=None` unless the dataset has been proven safe against truncating media tokens;
6. support image first, then audio/video after image training is validated;
7. emit deterministic dataset/media hashes and environment metadata;
8. save an adapter and a machine-readable evidence record;
9. run held-out multimodal evaluation against the same media integrity rules;
10. never mix evaluation media into training.

## Readiness gate

`manifest_v2.json` intentionally keeps `native_multimodal_trainer` null until the implementation and real media corpus exist. Do not set it merely to unblock CI. The GO workflow must remain blocked until both are present.

## Recommended sequence

- Stage A: 2-10 real image records + one held-out image set.
- Stage B: document/PDF records with provenance.
- Stage C: short audio records (E2B audio support is limited to short clips; validate duration before training).
- Stage D: short video records and temporal evaluation.
- Stage E: mixed-modality records and contradiction/uncertainty cases.

The first implementation should prove one complete path end-to-end before expanding the corpus.
