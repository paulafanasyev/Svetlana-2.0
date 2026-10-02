# Acceptance Forensic V4 → V5

## Verified baseline
- Restored production corpus: 325 train records.
- Production SFT: 246 optimizer steps.
- Acceptance evaluator: `structured-v2.3`.
- Result: 20/24 (83.33%).
- Category regressions: none.

## V4 finding
Adding 12 broad hardening examples (6 calendar + 6 missing_data) reduced the same evaluation to 16/24.
V4 is therefore excluded from the production manifest.

## Remaining failures after rollback
- Calendar: `accept_013`, `accept_014` — generated responses omitted an explicit invitation/confirmation separation phrase.
- Missing-data: `accept_017`, `accept_018` — generated responses said data may be insufficient but omitted the explicit anti-guessing phrase recognized by the evaluator.

## V5 controlled intervention
Added exactly 4 synthetic training examples:
- 2 calendar examples reinforcing explicit separation of event creation from invitation sending.
- 2 missing-data examples reinforcing explicit `не буду угадывать` / `не стану придумывать` behavior.

No held-out acceptance prompt or answer was copied into training.
No evaluator rule was changed.
No V4 records were reintroduced.

## Expected corpus change
325 -> 329 train records.
With batch 1 / gradient accumulation 4 / 3 epochs:
249 expected optimizer steps.

## Gate
Re-run Training Validation and CI before any Colab SFT.
Success of those gates is code/CI evidence only; model acceptance still requires a fresh Colab run.
