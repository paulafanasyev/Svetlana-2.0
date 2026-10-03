# Real multimodal dataset

The repository currently contains the curriculum contract but no approved media corpus. Add real records only after they satisfy `MULTIMODAL_DATA_CONTRACT.md`.

Required before native multimodal training:

- approved synthetic/public-domain/licensed media
- deterministic SHA-256 hashes
- provenance/license metadata
- train/eval separation
- native multimodal trainer
- validator that loads every referenced media file and verifies its hash
- multimodal evaluation cases with machine-checkable rubrics

Until these conditions are met, the training GO gate must remain blocked.
