# Open-source Capability Discovery — 2026-09

## Review standard
Repository README is discovery evidence only. Adoption decisions require source-code, license, maturity, security/privacy and integration review.

| Project | Origin | Observed capability | License evidence | Code evidence | Svetlana mapping | Decision |
|---|---|---|---|---|---|---|
| QwenLM/Qwen-Agent | China | Agents, planning, tool use, memory; BaseTool + tool registry and JSON-schema validation | Apache-2.0 | Reviewed `qwen_agent/tools/base.py` | 02.agent.registry, tool-calling curriculum | REFERENCE / ADAPT |
| bytedance/ui-tars-desktop | China | GUI agent, vision, desktop/browser operators, MCP integration | Apache-2.0 | Repository structure + implementation docs reviewed | 01.communication, 09.runtime.web, GUI training | REFERENCE / ADAPT |
| opendatalab/MinerU | China | PDF/document ingestion, many office/text formats, parsing and structured document workflows | LICENSE.md present; exact terms require license file review before redistribution | Reviewed `mineru/filetypes.py` and package structure | 01.communication, documents, RAG ingest | REFERENCE / ADAPT |
| PaddlePaddle/PaddleOCR | China | OCR and document-to-Markdown pipelines | Apache-2.0 | Reviewed `paddleocr/_doc2md/__init__.py` and package structure | OCR, multimodal docs, verification | REFERENCE / ADAPT |
| FoundationAgents/OpenManus | China/global | Tool-calling agent, MCP clients, Browser Use integration, multi-step execution | MIT | Reviewed `app/agent/manus.py` | 02.agent, 09.runtime.web | REFERENCE / LEARN |
| browser-use/browser-use | Global | Browser agent, tools/skills, browser session state, visual/browser interaction | MIT | Reviewed `browser_use/agent/service.py` | 09.runtime.web, 02.agent, research | REFERENCE / ADAPT |

## Key architectural lessons
1. Tool registries should be explicit and schema-driven rather than model-only.
2. Browser/GUI control must be treated as a separate runtime evidence layer.
3. Document ingestion should expose format/type and structured errors so Svetlana can choose the right parser.
4. MCP is useful as an internal transport, but the canonical Svetlana interface remains provider-neutral.
5. External projects should supply patterns/modules, not become hidden dependencies without explicit governance.

## Current discovery sources
- https://github.com/QwenLM/Qwen-Agent
- https://github.com/bytedance/UI-TARS-desktop
- https://github.com/opendatalab/MinerU
- https://github.com/PaddlePaddle/PaddleOCR
- https://github.com/FoundationAgents/OpenManus
- https://github.com/browser-use/browser-use
- https://github.com/open-browser-use/open-browser-use

Status: REFERENCE candidates only; no external repository code has been copied into Svetlana by this discovery update.
