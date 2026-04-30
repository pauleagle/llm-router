# Contributing

Thanks for your interest in improving Local LLM Router.

This project is currently a small local-first router foundation. Contributions should keep the system simple, observable, and easy to run on local hardware.

## Project Goals

- Keep the router lightweight.
- Preserve OpenAI-compatible API behavior.
- Keep internal routing logic separate from external client interfaces.
- Prefer readable TypeScript over clever abstractions.
- Make routing decisions observable through debug logs.
- Avoid unnecessary dependencies.

## Development Setup

Install dependencies:

```bash
npm install
```

Run in development mode:

```bash
npm run dev
```

Make sure Ollama is running locally:

```bash
ollama serve
```

Pull required models as needed:

```bash
ollama pull phi3:mini
ollama pull mistral:7b-instruct
ollama pull deepseek-coder:6.7b-instruct
ollama pull nomic-embed-text
```

## Recommended Workflow

1. Create a branch:

```bash
git checkout -b feat/my-change
```

2. Make your changes.

3. Test with debug mode enabled:

```bash
npm run dev
```

4. Check the router logs.

5. Commit with a clear message:

```bash
git commit -m "feat: add router retry strategy"
```

## Commit Message Style

Recommended prefixes:

```txt
feat:     new feature
fix:      bug fix
refactor: internal restructuring
docs:     documentation only
test:     tests
chore:    tooling or maintenance
```

Examples:

```txt
feat: add hybrid rule-based routing
fix: repair OpenAI stream done chunk
docs: update setup instructions
refactor: extract router pipeline
```

## Code Guidelines

- Keep route handlers small.
- Put shared logic into helper functions.
- Avoid duplicating routing logic between `/api/chat` and `/v1/chat/completions`.
- Keep intent names stable unless there is a migration plan.
- Prefer explicit error handling.
- Keep debug logs useful but not noisy.
- Do not commit local model files, logs, `.env`, or `node_modules`.

## Routing Guidelines

When changing routing behavior:

- Update `intent-config.json` when possible instead of hardcoding policy.
- Preserve existing intents unless intentionally migrating.
- Add debug logs for new routing decisions.
- Keep classifier output strict and machine-readable.
- Prefer hybrid rules for obvious cases, such as coding or title-generation requests.

## API Compatibility Guidelines

The public endpoint should remain compatible with OpenAI-style clients:

```txt
POST /v1/chat/completions
```

Be careful when changing:

- response schema
- streaming chunk format
- finish reason
- error shape
- embeddings response format

## Documentation Guidelines

Update documentation when changing:

- endpoints
- required models
- environment variables
- routing behavior
- setup commands
- known limitations

## Release Checklist

Before tagging a release:

```bash
git status
npm run dev
```

Then verify:

- `/health` works
- `/v1/chat/completions` works
- `/api/chat` works
- coding prompts route to the coding model
- normal analysis prompts route to the expected model
- debug logs are understandable
- README and CHANGELOG are updated

Create a tag:

```bash
git tag v1.0.0
git push origin master --tags
```

## Future Contribution Ideas

- Hybrid router rules
- Classifier retry / repair
- Request tracing
- Usage tracking
- Response caching
- Better streaming compliance
- Configurable environment variables
- Model health checks
- Per-intent budget limits
