# Svetlana LiteRT-LM Edge Runtime Plan

Status vocabulary: VERIFIED / NOT PROVEN / PENDING.

## Objective

Add LiteRT-LM as the on-device inference/runtime track for Svetlana without replacing the existing training pipeline.

The trained Svetlana model remains a separate artifact. LiteRT-LM is evaluated as the Android/local inference and orchestration layer.

## Current upstream baseline (2026-09-12)

- Google LiteRT-LM stable release observed: v0.16.0.
- LiteRT-LM is an open-source orchestration/inference framework for LLMs on edge devices.
- v0.16.0 includes versioned C API prebuilts and an experimental YNNPACK delegate.
- GPU execution for the LFM2.5 LiteRT-LM exports requires LiteRT-LM >= 0.16.0.
- LFM2.5 1.2B and 2.6B have current `.litertlm` community exports with bundled executor metadata and tool-list capable chat templates.

These are external upstream facts and must be rechecked before pinning a production dependency.

## Candidate local models

### Candidate A — LFM2.5-1.2B-Instruct

Initial Android smoke candidate because the int4 artifact is about 736 MB and has a GPU-capable export. Current published manifest reports a 4096-token context and CPU/GPU variants. The GPU-capable file is specifically required for GPU backends because the CPU-lineage export has known GPU engine-creation issues.

### Candidate B — LFM2.5-2.6B

Second-stage candidate. Current int4 export is about 1.67 GB and supports CPU/GPU with LiteRT-LM >= 0.16.0. It is a thinking model and declares a thought channel. It should be benchmarked only after the 1.2B path is stable.

Neither candidate is yet approved as Svetlana's production model.

## Architecture

```text
Svetlana app
    |
    +-- Cloud model adapter -------------------+
    |                                           |
    +-- LiteRT-LM local runtime                 |
            |                                   |
            +-- local model                    |
            +-- tool interface -----------------+---- Orchestrator
                                                    |
                                            Planner / Policy
                                                    |
                                           Tool Registry / CRM
                                                    |
                                             Hands / Android
```

LiteRT-LM must not receive unrestricted access to sensitive tools. Tool execution remains behind the existing Policy/Tool Registry boundary and confirmation rules.

## Android acceptance gates

1. **Build:** LiteRT-LM dependency can be integrated without breaking the existing Android build.
2. **Load:** a published `.litertlm` candidate loads on the target Android API/device.
3. **Inference:** deterministic probe produces a valid response.
4. **Conversation:** at least three turns work without state corruption.
5. **Tool declaration:** runtime can expose the tool list without bypassing Policy.
6. **Tool denial:** an unsafe/sensitive tool is denied without explicit confirmation.
7. **Memory:** record peak memory and startup/load time.
8. **Performance:** record prefill and decode tokens/sec where available.
9. **Offline:** inference continues with network disabled after the model is installed.
10. **Fallback:** cloud/local routing failure is explicit and observable; no silent fake success.
11. **Device matrix:** record results separately for emulator and physical Poco X3 NFC. Never infer physical-device success from emulator success.

## Model/training relationship

The first LiteRT-LM milestone uses a published base model only. It does NOT claim that the model is trained as Svetlana.

After the custom Svetlana adapter is actually trained and evaluated, investigate whether the selected model architecture/export path supports the required conversion and adapter merge. Do not assume that a PyTorch/LoRA adapter can be dropped directly into a `.litertlm` artifact.

## Security/data rules

- Personal CRM data stays outside model weights.
- Current laws stay in a refreshable official-source/RAG layer.
- API keys and credentials never enter model artifacts.
- Local model files are verified by SHA-256 before activation.
- Runtime version and model manifest are recorded with every benchmark.
- Any model downloaded from a third-party repository is treated as untrusted until checksum/license/runtime compatibility is recorded.

## Immediate execution order

1. Pin an explicit LiteRT-LM runtime version for the smoke branch; start at >= 0.16.0 for GPU-capable LFM2.5 testing.
2. Add a small Android compatibility harness behind a feature flag.
3. Test LFM2.5-1.2B int4 CPU first, then its GPU export.
4. Capture logcat, runtime version, model SHA-256, load time, memory, prompt/output and backend.
5. Repeat on Poco X3 NFC.
6. Test LFM2.5-2.6B only if 1.2B passes the acceptance gates.
7. Only after runtime validation, evaluate custom-Svetlana model conversion/export.

## Current status

- LiteRT-LM upstream activity: VERIFIED by current upstream release/project data.
- LFM2.5 LiteRT-LM artifacts: VERIFIED as published artifacts.
- Android integration in Svetlana-2.0: NOT PROVEN.
- Poco X3 NFC LiteRT-LM inference: NOT PROVEN.
- Custom Svetlana adapter in LiteRT-LM: NOT PROVEN.
- Offline Hands/tool execution through LiteRT-LM: NOT PROVEN.
