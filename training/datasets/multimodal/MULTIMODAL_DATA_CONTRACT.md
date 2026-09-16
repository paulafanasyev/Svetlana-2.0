# Svetlana multimodal data contract

This directory is a contract for the real multimodal dataset. The curriculum file is **not** itself training data.

## Required modalities

- image: UI/screen understanding, document/OCR, visual grounding
- document: PDF/document extraction with provenance
- audio: speech understanding, uncertainty and background-noise separation
- video: temporal/event understanding
- mixed: text + one or more media inputs

## Every training record must contain

- stable `id`
- `modality`
- `task`
- `messages` or an explicitly documented multimodal conversation schema
- `media` entries with type, relative path, SHA-256, license/provenance
- `expected_output` or a machine-checkable rubric
- `privacy_classification`
- `source` and `source_date` when external knowledge is involved
- `split` (`train` only for this dataset; eval records stay elsewhere)

## Media policy

Only synthetic, public-domain, or otherwise explicitly licensed material may enter the repository. No private user documents, credentials, faces, voices, or personal CRM records.

Media files are referenced by repository-relative paths and SHA-256 hashes. A missing file, hash mismatch, missing license/provenance, or schema violation is a hard validation failure.

## Evaluation separation

Do not reuse the same media or near-duplicates between training and held-out evaluation. Evaluation media and expected outputs belong under the evaluation tree, not in this training directory.

## Trainer requirement

A native multimodal trainer must consume the declared media fields without converting them into pretend text-only placeholders. Until that trainer and real media assets exist, the GO pipeline must stop before SFT.

## Quality targets

The first real corpus should cover at minimum:

1. screen/UI grounding
2. OCR/document extraction
3. audio transcription/understanding
4. video temporal reasoning
5. mixed text-media reasoning
6. uncertainty and refusal to invent unseen content
7. provenance/source tracking
8. privacy-sensitive media handling
9. tool-oriented outputs derived from media
10. cross-modal contradiction detection
