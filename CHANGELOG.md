# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- Added Jest-based unit test coverage for router core behavior:
  - router task type normalization
  - router confidence normalization
  - router JSON parsing and legacy `intent` compatibility
  - model policy resolution
  - single-model gate behavior
  - OpenAI-compatible response mapping
- Added StrykerJS mutation testing configuration for the router core test surface.
- Added npm scripts for build, Jest tests, watch mode, and mutation testing:
  - `npm run build`
  - `npm test`
  - `npm run test:watch`
  - `npm run test:mutation`

### Changed

- Exported selected router core helpers from `server.ts` so they can be tested directly.
- Wrapped server startup in `startServer()` and guarded it behind direct module execution so importing `server.ts` in tests does not start the Express server.
- Allowed single-model gate checks to accept injected `ollama ps` output for deterministic tests.
- Added TypeScript deprecation suppression for the current Node module resolution setting under TypeScript 6.

### Internal

- Established an initial mutation testing baseline focused on covered router core logic.
- Scoped mutation testing away from Express route handlers and server startup code until those areas have dedicated tests.

## [v1.1.0] - 2026-05-07

### Added

- Integrated `model-fit-profiler` routing recommendations into `llm-router`.
- Expanded task-based routing from basic intent routing to profiler-driven task routing.
- Added support for the following task types:

```txt
short_question
analysis
coding
debug
draft_generation
knowledge_refine
prompt_engineering
router
summarization
general
```

- Added support for profiler-style model policy fields:

```txt
primary
fallback
fast
quality
explanation
```

- Added external task system prompt configuration through:

```txt
task_system_prompts.json
```

- Added separation between:
  - model routing policy
  - task-specific system prompts
  - runtime router execution
- Added support for `task_type` as the canonical router output field.
- Added backward compatibility for the legacy `intent` router output field.
- Added backward compatibility for legacy model policy fields:
  - `primaryModel`
  - `fallbackModel`
  - `systemPromptLines`
- Added router fallback model support.
- Added runtime debug endpoint:

```txt
GET /debug/routes
```

- Added richer `/health` response including:
  - router version
  - router model
  - preloaded models

### Changed

- Updated `server.ts` for `v1.1.0` profiler-driven routing.
- Router model is now resolved from `intent-config.json`:

```json
{
  "router": {
    "primary": "phi3:mini",
    "fallback": "gemma3:1b"
  }
}
```

- Preload behavior now uses the configured router model instead of a hardcoded model.
- Model selection now resolves models in this order:
  - `primary`
  - legacy `primaryModel`
  - analysis fallback
  - hardcoded safety fallback
- Single-model gate fallback now resolves models in this order:
  - `fast`
  - `fallback`
  - legacy `fallbackModel`
  - `quality`
  - `explanation`
  - `primary`
  - legacy `primaryModel`
- OpenAI-compatible non-streaming responses now include router metadata:

```json
{
  "router": {
    "task_type": "analysis",
    "confidence": 0.95,
    "reason": "..."
  }
}
```

- Internal non-streaming `/api/chat` responses now include router metadata.
- Router classification now normalizes invalid task types to `analysis`.
- Router confidence values are now normalized to the range `0.0` to `1.0`.

### Fixed

- Reduced coupling between `server.ts` and task-specific prompts.
- Avoided duplicating system prompts inside `intent-config.json`.
- Improved migration path from v1.0.0 intent-based routing to v1.1.0 task-based routing.
- Improved resilience when router output uses the old `intent` field.
- Improved resilience when router output is invalid JSON or does not match the expected schema.
- Improved stream parsing safety by skipping malformed upstream stream lines in debug mode.
- Improved OpenAI-compatible embedding input handling for string and array input values.

### Known Limitations

- Router classification may still misclassify ambiguous technical concept questions as `short_question`.
- No deterministic routing override layer yet.
- No automatic retry or repair pass for malformed router JSON beyond fallback normalization.
- No automatic import command for `model-fit-profiler` recommendation files.
- No runtime feedback loop from actual user satisfaction back into `model-fit-profiler`.
- Token accounting still depends on what Ollama returns.
- No persistent request tracing or evaluation log yet.

### Notes

This release is the first profiler-driven routing release.

The intended workflow is:

```txt
model-fit-profiler
  → phase1 profiling
  → phase2 LLM-as-a-judge
  → phase3 routing recommendations
  → intent-config.json
  → llm-router runtime routing
```

Conceptually:

```txt
model-fit-profiler = evaluate and recommend
llm-router         = route and execute
```

## [v1.0.0] - 2026-04-30

### Added

- Initial working local LLM router.
- OpenAI-compatible chat endpoint:

```txt
POST /v1/chat/completions
```

- Internal router endpoint:

```txt
POST /api/chat
```

- Intent-based routing using a lightweight local model.
- Supported intent categories:
  - `short_question`
  - `analysis`
  - `coding`
  - `draft_generation`
- Model selection based on `intent-config.json`.
- Primary and fallback model policy support.
- Prompt building from intent-specific system prompt lines.
- Ollama chat integration through:

```txt
/api/chat
```

- Streaming response support.
- Non-streaming response support.
- Router model preloading.
- Resource-aware running-model gate using `ollama ps`.
- OpenAI-compatible response adapter.
- Internal embeddings endpoint:

```txt
POST /api/embeddings
```

- OpenAI-compatible embeddings alias:

```txt
POST /v1/embeddings
```

- Health check endpoint:

```txt
GET /health
```

- Debug logging for:
  - router raw output
  - selected intent
  - confidence
  - selected generation model
  - fallback decisions

### Fixed

- Added OpenAI-compatible endpoint to support clients such as Chatbox.
- Separated public OpenAI-compatible API from internal Ollama-style router API.
- Improved router JSON handling by using stricter JSON output behavior.
- Avoided treating the preloaded router model as a heavy generation model in the fallback gate.

### Known Limitations

- Intent classification may still fail on ambiguous prompts.
- No automatic retry when classification fails.
- No cache layer.
- No full token accounting.
- Streaming transformation is functional but still basic.
- Runtime configuration is mostly hardcoded in `server.ts`.

### Notes

This release represents the first stable architecture checkpoint:

```txt
Client
  → OpenAI-compatible adapter
  → intent router
  → model selector
  → Ollama
```
