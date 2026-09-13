# Svetlana multimodal asset manifest v1

This file defines the metadata contract for real media used by the first multimodal training generation.

## Required fields

- `asset_id`: stable unique identifier.
- `curriculum_id`: one of the curriculum contracts in `multimodal_training_curriculum.jsonl`.
- `media_type`: `image`, `audio`, `document`, `video`, or `mixed`.
- `path`: repository-relative or approved external asset path. Do not put credentials or signed URLs here.
- `source_url`: original public source when applicable.
- `license`: explicit license or `OWNER_PROVIDED` when the asset is supplied by the project owner.
- `sha256`: SHA-256 of the exact asset bytes.

## Recommended fields

- `source_title`
- `created_at`
- `language`
- `content_description`
- `privacy_status`
- `split`: `train` or `eval`.
- `annotation_version`

## Security and provenance rules

1. No passwords, access tokens, private keys, cookies, payment credentials, or other secrets in media or metadata.
2. Do not use personal data in model weights without an explicit approved data policy; prefer synthetic, public, or owner-provided examples that contain no unnecessary personal data.
3. A source URL is provenance, not proof of license. License must be recorded separately.
4. The SHA-256 must be computed from the exact bytes consumed by the trainer.
5. If an asset changes, its hash and metadata record must change; never silently replace bytes under the same hash.
6. Train and eval assets must have disjoint hashes.
7. Multimodal records must preserve the media reference when converted to native Gemma 4 messages; flattening media into a text-only description is not an acceptable substitute for a native multimodal training example.
8. For revoked, expired, or uncertain rights, remove the asset from the training set rather than treating provenance as permission.

## Status vocabulary

- `CANDIDATE`: metadata incomplete; cannot enter training.
- `READY`: metadata complete and asset bytes verified.
- `REJECTED`: rights, privacy, integrity, or modality requirements failed.

No asset is considered training-ready merely because its metadata file exists.
