# Local LLM Router

An Ollama-based local LLM routing server with an OpenAI-compatible API.

This project turns multiple local models into a task-aware routing system. It classifies incoming requests, selects a suitable local model, builds the correct system prompt, and forwards the request to Ollama.

Starting from `v1.1.0`, this project can use routing recommendations produced by `model-fit-profiler`.

## Current Version

```txt
v1.1.0
```

This version is the first profiler-driven routing release.

It connects offline model evaluation results from `model-fit-profiler` with runtime model routing decisions in `llm-router`.

## What This Project Does

```txt
User request
  → classify task type
  → select suitable local model
  → apply task-specific system prompt
  → call Ollama
  → return OpenAI-compatible response
```

## Relationship with model-fit-profiler

`model-fit-profiler` evaluates local models across task types and produces routing recommendations.

`llm-router` applies those recommendations at runtime.

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

## Features

- OpenAI-compatible chat endpoint
- Internal Ollama-style chat endpoint
- Task-type routing
- Profiler-driven model policy support
- Multi-model selection
- Task-specific system prompt injection
- Ollama integration
- Streaming response support
- Non-streaming response support
- Router model preloading
- Resource-aware fallback gate for small-GPU devices
- Embeddings endpoint
- Debug route inspection endpoint
- Backward compatibility with v1.0.0 intent configuration style

## Architecture

```txt
Client / Chatbox / OpenAI-compatible SDK
        ↓
/v1/chat/completions
        ↓
OpenAI-compatible adapter
        ↓
Router pipeline
        ├─ Task classifier
        ├─ Model selector
        ├─ Prompt builder
        └─ Single-model gate
        ↓
Ollama /api/chat
```

## Runtime Routing Flow

```txt
messages[]
  ↓
extract latest user message
  ↓
router model classifies task_type
  ↓
load model policy from intent-config.json
  ↓
load system prompt from task_system_prompts.json
  ↓
check running model gate
  ↓
select generation model
  ↓
call Ollama
```

## Supported Task Types

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

## Recommended Model Policy Example

`v1.1.0` supports profiler-style model policy fields:

```json
{
  "analysis": {
    "primary": "mistral:7b-instruct",
    "quality": "phi3:mini"
  },
  "coding": {
    "primary": "deepseek-coder:6.7b-instruct"
  },
  "debug": {
    "primary": "deepseek-coder:6.7b-instruct",
    "explanation": "mistral:7b-instruct"
  },
  "draft_generation": {
    "primary": "mistral:7b-instruct",
    "fast": "phi3:mini"
  },
  "knowledge_refine": {
    "primary": "phi3:mini",
    "quality": "mistral:7b-instruct"
  },
  "prompt_engineering": {
    "primary": "phi3:mini"
  },
  "router": {
    "primary": "phi3:mini",
    "fallback": "gemma3:1b"
  },
  "short_question": {
    "primary": "gemma3:1b",
    "fallback": "llama3.2:3b"
  },
  "summarization": {
    "primary": "llama3.2:3b"
  }
}
```

## Configuration Files

### `intent-config.json`

Defines task type to model policy mapping.

Responsibilities:

- Which model should handle each task type
- Which model is primary
- Which model is fallback
- Which model is fast / quality / explanation-oriented

Example:

```json
{
  "coding": {
    "primary": "deepseek-coder:6.7b-instruct"
  }
}
```

### `task_system_prompts.json`

Defines task-specific system prompts.

Responsibilities:

- Router classification prompt
- Coding assistant behavior
- Debug / RCA behavior
- Knowledge refinement behavior
- Prompt engineering behavior
- Short answer behavior
- Draft generation behavior

Example:

```json
{
  "coding": "你是一個工程實作助手，專注於產生可維護、可執行、可理解的程式碼。"
}
```

## Model Selection Policy

Normal path:

```txt
task_type
  → intent-config.json
  → primary model
```

Single-model gate path:

```txt
if another generation model is running:
  use fast / fallback / quality / explanation model when available
```

Fallback priority:

```txt
fast
fallback
fallbackModel
quality
explanation
primary
primaryModel
analysis fallback
```

This is useful for devices with limited GPU memory, such as a 4GB VRAM local LLM environment.

## Requirements

- Node.js 20+
- Ollama
- TypeScript
- Required local models pulled in Ollama

Example models:

```bash
ollama pull phi3:mini
ollama pull gemma3:1b
ollama pull llama3.2:3b
ollama pull mistral:7b-instruct
ollama pull deepseek-coder:6.7b-instruct
ollama pull nomic-embed-text
```

## Installation

```bash
npm install
```

## Development

```bash
npm run dev
```

Default server:

```txt
http://localhost:3000
```

## Environment Variables

```txt
PORT=3000
OLLAMA_BASE=http://127.0.0.1:11434
DEBUG=true
```

Example:

```bash
cross-env DEBUG=true npx ts-node server.ts
```

## Chat Endpoint

OpenAI-compatible endpoint:

```txt
POST /v1/chat/completions
```

Example:

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {
        "role": "user",
        "content": "Write a Python script to read a local JSON file."
      }
    ],
    "stream": false
  }'
```

Non-streaming responses include router metadata:

```json
{
  "router": {
    "task_type": "coding",
    "confidence": 0.95,
    "reason": "User asks for code generation."
  }
}
```

## Internal Endpoint

Native internal router endpoint:

```txt
POST /api/chat
```

This keeps the internal router interface separate from the OpenAI-compatible public interface.

## Embeddings Endpoint

Internal embeddings endpoint:

```txt
POST /api/embeddings
```

OpenAI-compatible alias:

```txt
POST /v1/embeddings
```

The embedding model is fixed to:

```txt
nomic-embed-text
```

## Health Check

```txt
GET /health
```

Example response:

```json
{
  "ok": true,
  "version": "1.1.0",
  "router_model": "phi3:mini",
  "preload_models": ["phi3:mini"]
}
```

## Debug Routes

```txt
GET /debug/routes
```

Returns loaded task types, routing config, and system prompt keys.

This is useful for checking whether `intent-config.json` and `task_system_prompts.json` are loaded correctly.

## Debug Logs

Run with debug enabled:

```bash
cross-env DEBUG=true npx ts-node server.ts
```

Debug logs include:

- raw router classification result
- selected task type
- confidence
- selected generation model
- fallback gate decisions
- skipped malformed stream lines

Example:

```txt
[router raw] {
  "task_type": "analysis",
  "confidence": 0.95,
  "reason": "User asks for technical concept explanation."
}
[router] task_type=analysis confidence=0.95 reason=User asks for technical concept explanation.
[generation] model=mistral:7b-instruct
```

## Backward Compatibility

`v1.1.0` keeps compatibility with v1.0.0 configuration style.

Supported legacy router output field:

```txt
intent
```

Supported legacy model policy fields:

```txt
primaryModel
fallbackModel
systemPromptLines
```

This allows gradual migration from intent-based routing to task-type routing.

## Known Limitations

- Router classification may still fail on ambiguous prompts.
- Technical concept explanations may sometimes be classified as `short_question`.
- No deterministic routing override layer yet.
- No automatic retry or repair pass for malformed router JSON beyond fallback normalization.
- No automatic import command for `model-fit-profiler` recommendation files.
- No runtime feedback loop from actual usage back into `model-fit-profiler`.
- Streaming support is functional but not fully spec-complete.
- Token usage depends on what Ollama returns.
- No caching layer yet.
- No persistent request tracing yet.

## Roadmap

Possible next steps:

- Deterministic routing override layer
- Classifier retry and JSON repair
- Import command for `model-fit-profiler` routing recommendations
- Runtime feedback logging
- Request tracing
- Response quality annotation
- Usage tracking
- Response caching
- Better OpenAI streaming compatibility
- Per-task budget control
- Model health checks
- Model availability checks
- Router evaluation test suite

## Version Direction

```txt
v1.0.0  Working router MVP
v1.1.0  Profiler-driven routing integration
v1.1.1  Router policy refinement and deterministic overrides
v1.2.0  Automatic recommendation import
v1.3.0  Runtime feedback loop
```

## License

MIT, or replace with your preferred license.
