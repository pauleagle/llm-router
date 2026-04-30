# Local LLM Router

An Ollama-based local LLM routing server with an OpenAI-compatible API.

This project turns multiple local models into a simple routing system. It classifies the incoming request, selects a suitable model, and forwards the request to Ollama.

## Features

- OpenAI-compatible chat endpoint
- Intent-based routing
- Multi-model selection
- Ollama integration
- Streaming response support
- Internal API endpoint
- Router model preloading
- Resource-aware fallback gate

## Current Version

`v1.0.0`

This version is the first working router foundation.

## Architecture

```txt
Client / Chatbox / OpenAI-compatible SDK
        ↓
/v1/chat/completions
        ↓
OpenAI-compatible adapter
        ↓
Router pipeline
        ├─ Intent classifier
        ├─ Model selector
        └─ Prompt builder
        ↓
Ollama /api/chat
```

## Intent Types

The router currently supports:

```txt
short_question
analysis
coding
draft_generation
```

## Requirements

- Node.js 20+
- Ollama
- TypeScript
- Required local models pulled in Ollama

Example models:

```bash
ollama pull phi3:mini
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

## Configuration

Routing policy is configured in:

```txt
intent-config.json
```

Each intent can define its primary and fallback model.

Example:

```json
{
  "coding": {
    "primaryModel": "deepseek-coder:6.7b-instruct",
    "fallbackModel": "phi3:mini",
    "systemPromptLines": [
      "You are a practical coding assistant.",
      "Prefer working code and clear explanations."
    ]
  }
}
```

## Debug Mode

Run with debug enabled:

```bash
cross-env DEBUG=true npx ts-node server.ts
```

Debug logs include:

- raw router classification result
- selected intent
- selected generation model
- fallback gate decisions

## Known Limitations

- Intent classification is still basic.
- Classifier reliability depends on the router model.
- Streaming support is functional but not fully spec-complete.
- Token usage is estimated or unavailable depending on Ollama response.
- No caching layer yet.
- No retry strategy yet.
- No persistent request logging yet.

## Roadmap

Possible next steps:

- Hybrid routing with rules plus LLM classification
- Classifier retry and repair
- Usage tracking
- Response caching
- Better OpenAI streaming compatibility
- Per-intent budget control
- Model health checks
- Configurable environment variables
- Request tracing

## License

MIT, or replace with your preferred license.
