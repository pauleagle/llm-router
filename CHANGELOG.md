# Changelog

All notable changes to this project will be documented in this file.

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
