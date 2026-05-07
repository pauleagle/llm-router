import express from 'express';
import { execSync } from 'child_process';
import intentConfigJson from './intent-config.json';
import taskSystemPromptsJson from './task_system_prompts.json';

const app = express();
app.use(express.json());

/**
 * =====================
 * 基本設定（v1.1.0）
 * =====================
 */
const OLLAMA_BASE = process.env.OLLAMA_BASE ?? 'http://127.0.0.1:11434';
const PORT = Number(process.env.PORT ?? 3000);
const DEBUG = process.env.DEBUG === 'true';

/**
 * v1.1.0 重點：
 * 1. intent-config.json 專心管理「task_type -> model policy」
 * 2. task_system_prompts.json 專心管理「task_type -> system prompt」
 * 3. router 支援 task_type / intent 兩種欄位，方便從舊版平滑升級
 */

type TaskType =
  | 'short_question'
  | 'analysis'
  | 'coding'
  | 'debug'
  | 'draft_generation'
  | 'knowledge_refine'
  | 'prompt_engineering'
  | 'router'
  | 'summarization'
  | 'general';

type ModelPolicy = {
  primary?: string;
  fallback?: string;
  fast?: string;
  quality?: string;
  explanation?: string;

  // v1.0.0 相容欄位
  primaryModel?: string;
  fallbackModel?: string;
  systemPromptLines?: string[];
};

type IntentConfig = Partial<Record<TaskType, ModelPolicy>>;
type TaskSystemPrompts = Partial<Record<TaskType, string>>;

const intentConfig = intentConfigJson as IntentConfig;
const taskSystemPrompts = taskSystemPromptsJson as TaskSystemPrompts;

const DEFAULT_ROUTER_MODEL =
  intentConfig.router?.primary ??
  intentConfig.router?.primaryModel ??
  'phi3:mini';

const ROUTER_FALLBACK_MODEL =
  intentConfig.router?.fallback ??
  intentConfig.router?.fallbackModel ??
  'gemma3:1b';

/**
 * =====================
 * Phase 0: Pre-loading
 * =====================
 * P620 / 4GB VRAM：只預載 router model，避免一開機就佔滿資源。
 */
const PRELOAD_MODELS = Array.from(new Set([DEFAULT_ROUTER_MODEL]));

async function preloadModels() {
  console.log(`[preload] Starting: ${PRELOAD_MODELS.join(', ')}`);

  for (const model of PRELOAD_MODELS) {
    await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        keep_alive: '10m',
        stream: false,
        messages: [
          {
            role: 'user',
            content: 'ping'
          }
        ]
      })
    });
  }

  console.log('Router model preloaded.');
}

/**
 * =====================
 * Phase 1: Intent Router
 * =====================
 */
const FALLBACK_ROUTER_SYSTEM_PROMPT = `
Return JSON only.

You classify messages. You do not answer them.

Available task_type:
- coding
- analysis
- draft_generation
- short_question
- debug
- summarization
- knowledge_refine
- prompt_engineering
- general

Schema:
{"task_type":"coding|analysis|draft_generation|short_question|debug|summarization|knowledge_refine|prompt_engineering|general","confidence":0.0,"reason":"brief reason"}

Rules:
- Python/code/debug/script/scraper/crawler/API = coding
- Error/log/stack trace/root cause/fix bug = debug
- Explanation/diagnosis/comparison/why/trade-off = analysis
- Email/post/article/prose/README/CHANGELOG = draft_generation
- Summary/meeting notes/整理長文 = summarization
- Long-term reusable knowledge/refine/iron law/EvoMind = knowledge_refine
- Prompt for AI Studio/Copilot/Claude Code/Gemini CLI = prompt_engineering
- Simple factual/casual question = short_question

Return only one JSON object.
`;

const ROUTER_SYSTEM_PROMPT =
  taskSystemPrompts.router?.trim() || FALLBACK_ROUTER_SYSTEM_PROMPT;

const VALID_TASK_TYPES: ReadonlySet<TaskType> = new Set([
  'short_question',
  'analysis',
  'coding',
  'debug',
  'draft_generation',
  'knowledge_refine',
  'prompt_engineering',
  'router',
  'summarization',
  'general'
]);

type RouterResult = {
  task_type: TaskType;
  confidence: number;
  reason?: string;
};

type RouterRawResult = {
  task_type?: string;
  intent?: string;
  confidence?: number;
  reason?: string;
};

type ChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

type OllamaChatResponse = {
  model?: string;
  created_at?: string;
  message?: {
    role: string;
    content: string;
  };
  done?: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  prompt_eval_duration?: number;
  eval_count?: number;
  eval_duration?: number;
  embedding?: number[];
};

type GenerationPlan = {
  model: string;
  messages: ChatMessage[];
  routing: RouterResult;
};

function normalizeTaskType(value: unknown): TaskType {
  if (typeof value === 'string' && VALID_TASK_TYPES.has(value as TaskType)) {
    return value as TaskType;
  }

  return 'analysis';
}

function normalizeConfidence(value: unknown): number {
  if (typeof value !== 'number' || Number.isNaN(value)) {
    return 0.0;
  }

  return Math.max(0, Math.min(1, value));
}

function safeParseRouterResult(raw: string): RouterResult {
  try {
    const parsed = JSON.parse(raw) as RouterRawResult;

    // v1.1.0 使用 task_type；v1.0.0 相容 intent。
    const taskType = normalizeTaskType(parsed.task_type ?? parsed.intent);

    return {
      task_type: taskType,
      confidence: normalizeConfidence(parsed.confidence),
      reason: parsed.reason
    };
  } catch {
    return {
      task_type: 'analysis',
      confidence: 0.0,
      reason: 'router output is not valid JSON'
    };
  }
}

async function routeIntent(userInput: string): Promise<RouterResult> {
  const resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: DEFAULT_ROUTER_MODEL,
      stream: false,
      format: 'json',
      messages: [
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        {
          role: 'user',
          content: `Classify this message only. Do not answer it.\n\nMESSAGE:\n${userInput}`
        }
      ]
    })
  });

  if (!resp.ok) {
    if (DEBUG) {
      console.log(
        `[router] primary failed: ${DEFAULT_ROUTER_MODEL}, fallback=${ROUTER_FALLBACK_MODEL}`
      );
    }

    return routeIntentWithFallback(userInput);
  }

  const json = (await resp.json()) as OllamaChatResponse;
  const raw = json.message?.content ?? '';

  if (DEBUG) {
    console.log(`[router raw] ${raw}`);
  }

  return safeParseRouterResult(raw);
}

async function routeIntentWithFallback(userInput: string): Promise<RouterResult> {
  try {
    const resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: ROUTER_FALLBACK_MODEL,
        stream: false,
        format: 'json',
        messages: [
          { role: 'system', content: ROUTER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Classify this message only. Do not answer it.\n\nMESSAGE:\n${userInput}`
          }
        ]
      })
    });

    if (!resp.ok) {
      return {
        task_type: 'analysis',
        confidence: 0.0,
        reason: 'router primary and fallback failed'
      };
    }

    const json = (await resp.json()) as OllamaChatResponse;
    return safeParseRouterResult(json.message?.content ?? '');
  } catch {
    return {
      task_type: 'analysis',
      confidence: 0.0,
      reason: 'router fallback request failed'
    };
  }
}

/**
 * =====================
 * Single-model gate（P620 專用）
 * =====================
 */
function hasRunningGenerationModel(): boolean {
  try {
    const out = execSync('ollama ps', { encoding: 'utf-8' }).trim();
    const lines = out.split('\n').filter(line => line.trim());

    // 第一行是 header。
    const modelLines = lines.slice(1);

    return modelLines.some(line => {
      const modelName = line.split(/\s+/)[0];

      // 忽略 router / preload model。
      return !PRELOAD_MODELS.includes(modelName);
    });
  } catch {
    return false;
  }
}

function resolvePrimaryModel(taskType: TaskType): string {
  const cfg = intentConfig[taskType] ?? intentConfig.analysis;

  return (
    cfg?.primary ??
    cfg?.primaryModel ??
    intentConfig.analysis?.primary ??
    intentConfig.analysis?.primaryModel ??
    'mistral:7b-instruct'
  );
}

function resolveFallbackModel(taskType: TaskType): string {
  const cfg = intentConfig[taskType] ?? intentConfig.analysis;

  // v1.1.0 policy：
  // - running gate 時，優先使用 fast / fallback
  // - 若沒有 fast / fallback，才退到 quality / explanation
  // - 最後才回到 primary
  return (
    cfg?.fast ??
    cfg?.fallback ??
    cfg?.fallbackModel ??
    cfg?.quality ??
    cfg?.explanation ??
    cfg?.primary ??
    cfg?.primaryModel ??
    resolvePrimaryModel('analysis')
  );
}

function resolveSystemPrompt(taskType: TaskType): string {
  const prompt = taskSystemPrompts[taskType];

  if (typeof prompt === 'string' && prompt.trim()) {
    return prompt.trim();
  }

  // v1.0.0 相容：若舊版 intent-config 還有 systemPromptLines，仍可運作。
  const cfg = intentConfig[taskType] ?? intentConfig.analysis;
  if (Array.isArray(cfg?.systemPromptLines)) {
    return cfg.systemPromptLines.join('\n');
  }

  return '';
}

/**
 * =====================
 * Phase 2: Model Selector + Prompt Builder
 * =====================
 */
function selectAndBuildPrompt(taskType: TaskType, userInput: string): {
  model: string;
  messages: ChatMessage[];
} {
  const primaryModel = resolvePrimaryModel(taskType);
  const fallbackModel = resolveFallbackModel(taskType);
  const running = hasRunningGenerationModel();

  let model = primaryModel;

  if (running && primaryModel !== fallbackModel) {
    if (DEBUG) {
      console.log(
        `[gate] running model detected, fallback ${primaryModel} → ${fallbackModel}`
      );
    }
    model = fallbackModel;
  }

  const systemPrompt = resolveSystemPrompt(taskType);

  const messages: ChatMessage[] = systemPrompt
    ? [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userInput }
      ]
    : [{ role: 'user', content: userInput }];

  return { model, messages };
}

/**
 * =====================
 * Shared Router Pipeline
 * =====================
 */
async function buildGenerationPlan(messages: ChatMessage[]): Promise<GenerationPlan> {
  const userInput =
    [...messages].reverse().find(message => message.role === 'user')?.content ?? '';

  const routing = await routeIntent(userInput);

  if (DEBUG) {
    console.log(
      `[router] task_type=${routing.task_type} confidence=${routing.confidence} reason=${routing.reason ?? ''}`
    );
  }

  const { model, messages: cleanMessages } = selectAndBuildPrompt(
    routing.task_type,
    userInput
  );

  if (DEBUG) {
    console.log(`[generation] model=${model}`);
  }

  return {
    model,
    messages: cleanMessages,
    routing
  };
}

async function callOllamaChat(plan: GenerationPlan, stream: boolean) {
  return fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: plan.model,
      stream,
      messages: plan.messages
    })
  });
}

/**
 * =====================
 * OpenAI-compatible helpers
 * =====================
 */
function toOpenAIChatCompletion(json: OllamaChatResponse, plan: GenerationPlan) {
  return {
    id: `chatcmpl-local-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: plan.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: json.message?.content ?? ''
        },
        finish_reason: 'stop'
      }
    ],
    usage: {
      prompt_tokens: json.prompt_eval_count ?? 0,
      completion_tokens: json.eval_count ?? 0,
      total_tokens: (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0)
    },
    router: {
      task_type: plan.routing.task_type,
      confidence: plan.routing.confidence,
      reason: plan.routing.reason
    }
  };
}

function writeOpenAIStreamChunk(
  res: express.Response,
  model: string,
  content: string
) {
  const chunk = {
    id: `chatcmpl-local-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {
          content
        },
        finish_reason: null
      }
    ]
  };

  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
}

function writeOpenAIStreamDone(res: express.Response, model: string) {
  const chunk = {
    id: `chatcmpl-local-${Date.now()}`,
    object: 'chat.completion.chunk',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        delta: {},
        finish_reason: 'stop'
      }
    ]
  };

  res.write(`data: ${JSON.stringify(chunk)}\n\n`);
  res.write('data: [DONE]\n\n');
}

/**
 * =====================
 * Phase 3A: Internal API
 * 保留原本 /api/chat 行為
 * =====================
 */
app.post('/api/chat', async (req, res) => {
  try {
    const { messages = [], stream = true } = req.body;

    const plan = await buildGenerationPlan(messages);
    const upstream = await callOllamaChat(plan, stream);

    if (!upstream.ok) {
      return res.status(upstream.status).json(await upstream.json());
    }

    if (!stream) {
      const json = (await upstream.json()) as OllamaChatResponse;
      return res.json({
        ...json,
        router: {
          task_type: plan.routing.task_type,
          confidence: plan.routing.confidence,
          reason: plan.routing.reason
        }
      });
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    const reader = upstream.body?.getReader();
    if (!reader) {
      throw new Error('Upstream response body is empty.');
    }

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          // 這裡維持 Ollama 原生 stream，不轉 OpenAI schema。
          res.write(value);
        }
      }
    } finally {
      res.end();
    }
  } catch (err) {
    console.error('[api/chat] error', err);
    res.status(500).json({
      error: {
        message: 'Internal router error',
        type: 'router_error'
      }
    });
  }
});

/**
 * =====================
 * Phase 3B: OpenAI-compatible API
 * Chatbox / OpenAI SDK 用這條
 * =====================
 */
app.post('/v1/chat/completions', async (req, res) => {
  try {
    const { messages = [], stream = false } = req.body;

    const plan = await buildGenerationPlan(messages);
    const upstream = await callOllamaChat(plan, stream);

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: {
          message: await upstream.text(),
          type: 'ollama_error',
          code: upstream.status
        }
      });
    }

    if (!stream) {
      const json = (await upstream.json()) as OllamaChatResponse;
      return res.json(toOpenAIChatCompletion(json, plan));
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const reader = upstream.body?.getReader();
    if (!reader) {
      throw new Error('Upstream response body is empty.');
    }

    const decoder = new TextDecoder();
    let buffer = '';
    let doneWritten = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });

        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as OllamaChatResponse;
            const content = parsed.message?.content ?? '';

            if (content) {
              writeOpenAIStreamChunk(res, plan.model, content);
            }

            if (parsed.done && !doneWritten) {
              writeOpenAIStreamDone(res, plan.model);
              doneWritten = true;
            }
          } catch (parseErr) {
            if (DEBUG) {
              console.log(`[stream parse skipped] ${trimmed}`, parseErr);
            }
          }
        }
      }

      if (!doneWritten) {
        writeOpenAIStreamDone(res, plan.model);
      }
    } finally {
      res.end();
    }
  } catch (err) {
    console.error('[v1/chat/completions] error', err);

    if (!res.headersSent) {
      res.status(500).json({
        error: {
          message: 'OpenAI-compatible router error',
          type: 'router_error'
        }
      });
    } else {
      res.end();
    }
  }
});

/**
 * =====================
 * Embeddings（RAG-safe）
 * =====================
 */
app.post('/api/embeddings', async (req, res) => {
  try {
    const upstream = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...req.body,
        model: 'nomic-embed-text'
      })
    });

    res.status(upstream.status).json(await upstream.json());
  } catch (err) {
    console.error('[api/embeddings] error', err);
    res.status(500).json({
      error: {
        message: 'Embedding router error',
        type: 'embedding_error'
      }
    });
  }
});

/**
 * =====================
 * OpenAI-compatible Embeddings alias
 * =====================
 */
app.post('/v1/embeddings', async (req, res) => {
  try {
    const input = Array.isArray(req.body.input)
      ? req.body.input.join('\n')
      : String(req.body.input ?? '');

    const upstream = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: input,
        model: 'nomic-embed-text'
      })
    });

    if (!upstream.ok) {
      return res.status(upstream.status).json({
        error: {
          message: await upstream.text(),
          type: 'ollama_embedding_error',
          code: upstream.status
        }
      });
    }

    const json = (await upstream.json()) as OllamaChatResponse;

    res.json({
      object: 'list',
      data: [
        {
          object: 'embedding',
          embedding: json.embedding ?? [],
          index: 0
        }
      ],
      model: 'nomic-embed-text',
      usage: {
        prompt_tokens: 0,
        total_tokens: 0
      }
    });
  } catch (err) {
    console.error('[v1/embeddings] error', err);
    res.status(500).json({
      error: {
        message: 'OpenAI-compatible embedding router error',
        type: 'embedding_error'
      }
    });
  }
});

/**
 * =====================
 * Health / Debug
 * =====================
 */
app.get('/health', (_, res) => {
  res.json({
    ok: true,
    version: '1.1.0',
    router_model: DEFAULT_ROUTER_MODEL,
    preload_models: PRELOAD_MODELS
  });
});

app.get('/debug/routes', (_, res) => {
  res.json({
    version: '1.1.0',
    task_types: Array.from(VALID_TASK_TYPES),
    intent_config: intentConfig,
    system_prompt_keys: Object.keys(taskSystemPrompts)
  });
});

app.listen(PORT, () => {
  console.log(`Ollama router running at http://localhost:${PORT}`);
  console.log('Node 20 / TS6 / Node16 module mode');
  console.log(`DEBUG=${DEBUG}`);
  console.log(`Router model=${DEFAULT_ROUTER_MODEL}`);

  // 啟動後立即非同步預載，不阻塞 server 啟動。
  preloadModels().catch(err => {
    console.error('[preload] failed', err);
  });
});
