# Svetlana External Tool Architecture v1

## Purpose
Keep tool implementations outside Gemma. Gemma learns capability selection, structured tool calls, safety/confirmation, error handling, verification, and the no-claim-without-result rule.

## Runtime
User -> Gemma/Planner -> Capability Router -> existing ToolRegistry -> external/local tool -> result -> verification -> Svetlana.

## Backend classes
- LOCAL_FREE: preferred default; local/open-source and offline where practical.
- USER_CONNECTED: explicitly connected by the user.
- OPTIONAL_CLOUD: only when enabled and data-transfer policy permits.
- REJECTED: incompatible, unsafe, or licensing-blocked.

## Tool contract
Each registered external capability must declare:
- stable id and capability
- action
- source repository and exact version/commit
- software and model licenses
- runtime requirements
- network/offline behavior
- input and output schemas
- privacy/data-transfer behavior
- security review status
- tests/CI evidence
- Android/Termux compatibility
- Gemma compatibility
- availability check
- verification strategy
- risk level

## Core rule
Svetlana must never claim that an external action succeeded unless the tool returned success and, where required, independent verification passed.

## Free-first routing
LOCAL -> FREE/OPEN SOURCE -> USER_CONNECTED -> OPTIONAL_CLOUD.
Cloud tools are never assumed to be mandatory merely because a cloud backend exists.

## Examples
- image_generation -> local ComfyUI/Qwen Image backend -> result -> verification.
- OCR -> local PaddleOCR/Tesseract backend -> structured result -> verification.
- speech_to_text -> local faster-whisper/whisper.cpp backend -> transcript -> verification.
- document_generation -> deterministic DOCX/PDF renderer -> independent output validation.
- contracts -> GENERATED -> VALIDATED -> LEGAL_REVIEW_REQUIRED.

## Architecture boundary
Python/C++/native tools are external processes/services. Do not copy their implementations or large implementation documentation into model training data. Train capability routing and tool-call schemas instead.

## Training gate
EXTERNAL TOOLS PASS -> TOOL REGISTRY PASS -> CAPABILITY ROUTER PASS -> SCHEMAS PASS -> SECURITY PASS -> FREE-FIRST ROUTING PASS -> DATASET PASS -> TRAINING PRECHECK PASS -> TRAINING READY.
