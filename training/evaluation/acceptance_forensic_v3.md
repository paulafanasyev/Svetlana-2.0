# Acceptance forensic review v3

## Current observation

The production SFT run using the v4 production manifest completed successfully at 255/255 optimizer steps, but the 24-case structured acceptance evaluation produced 16/24 (66.67%).

The previous accepted training baseline for this branch was 20/24 (83.33%). The v4 change added 12 targeted examples on top of the existing v3 hardening set.

## Evidence

- Evaluator: `structured-v2.3`
- Held-out acceptance cases: 24
- v4 adapter: 16/24
- Baseline in the same run: 3/24
- Category regressions reported by the comparison tool: none relative to that run's baseline
- v4 affected production train corpus size: 337 records
- v3 production train corpus size before v4: 325 records

The checked-in evaluator tests confirm that the golden responses for all 24 acceptance cases pass 24/24. Therefore the current failure is not explained by the evaluator rejecting the canonical expected behavior.

## Regression diagnosis

The v4 examples overlap strongly with behavior already covered by v3, especially calendar invitation separation and missing-data/CRM routing. The v4 run also lost previously passing behavior in confirmation and document categories.

This makes the v4 manifest addition an unsafe production change despite passing static corpus and CI validation.

The correct isolation step is to remove v4 from the production manifest while retaining the v4 file as experimental material. This restores the last known production corpus composition without deleting the experiment.

## Decision

- Keep `svetlana_acceptance_hardening_v4.jsonl` in the repository as non-production experimental data.
- Remove v4 from `manifest_v2.json`.
- Do not change global SFT hyperparameters until the corpus rollback is re-evaluated.
- Re-run the production SFT from the restored 325-record corpus.
- Acceptance target remains 24/24 with zero category regressions.

## Status

VERIFIED: evaluator-v2.3 golden acceptance set passes 24/24.

VERIFIED: v4 training run completed and exported an adapter.

VERIFIED: v4 production corpus caused an observed acceptance result of 16/24.

PENDING: restored 325-record production SFT acceptance result.
