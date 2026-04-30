import express from 'express';
import { execSync } from 'child_process';
import intentConfig from './intent-config.json';

const app = express();
app.use(express.json());

/**
 * =====================
 * 基本設定（終態）
 * =====================
 */
const OLLAMA_BASE = 'http://127.0.0.1:11434'; // ollama 預設
const PORT = 3000;                           // 你的設計
const DEBUG = process.env.DEBUG === 'true';   // 顯性 opt-in

/**
 * =====================
 * Phase 0: Pre-loading
 * =====================
 */
const PRELOAD_MODELS = ['phi3:mini'];

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

  console.log(`Router model preloaded.`);
}

/**
 * =====================
 * Phase 1: Intent Router（phi3 mini）
 * =====================
 */
const ROUTER_SYSTEM_PROMPT = `
Return JSON only.

You classify messages. You do not answer them.

Schema:
{"intent":"short_question|analysis|coding|draft_generation","confidence":0.0}

Rules:
- Python/code/debug/script/scraper/crawler/API = coding
- Explanation/diagnosis/comparison = analysis
- Email/post/article/prose = draft_generation
- Simple factual/casual question = short_question

Return only one JSON object.
`;

type RouterResult = {
  intent: string;
  confidence: number;
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
};

type GenerationPlan = {
  model: string;
  messages: ChatMessage[];
  routing: RouterResult;
};

async function routeIntent(userInput: string): Promise<RouterResult> {
  const resp = await fetch(`${OLLAMA_BASE}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'phi3:mini',
      stream: false,
	  format: 'json',
      messages: [
        { role: 'system', content: ROUTER_SYSTEM_PROMPT },
        {
  role: 'user',
  content: `Classify this message only. Do not answer it.

MESSAGE:
${userInput}`
}
      ]
    })
  });

  const json = (await resp.json()) as OllamaChatResponse;

  try {
    const raw = json.message?.content ?? '';

    if (DEBUG) {
      console.log(`[router raw] ${raw}`);
    }
	
    const parsed = JSON.parse(json.message?.content ?? '{}') as RouterResult;

    if (!parsed.intent || typeof parsed.confidence !== 'number') {
      return { intent: 'analysis', confidence: 0.0 };
    }

    return parsed;
  } catch {
    return { intent: 'analysis', confidence: 0.0 };
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
    const lines = out.split('\n').filter(l => l.trim());

    // 第一行是 header
    const modelLines = lines.slice(1);

    return modelLines.some(line => {
      const modelName = line.split(/\s+/)[0];

      // 忽略 router / preload model
      return !PRELOAD_MODELS.includes(modelName);
    });
  } catch {
    return false;
  }
}

/**
 * =====================
 * Phase 2: Model Selector + Prompt Builder
 * （policy 來自 intent-config.json）
 * =====================
 */
function selectAndBuildPrompt(intent: string, userInput: string): {
  model: string;
  messages: ChatMessage[];
} {
  const cfg =
    (intentConfig as any)[intent] ??
    (intentConfig as any)['analysis'];

  const running = hasRunningGenerationModel();
  let model: string = cfg.primaryModel;

  if (running && cfg.primaryModel !== cfg.fallbackModel) {
    if (DEBUG) {
      console.log(
        `[gate] running model detected, fallback ${cfg.primaryModel} → ${cfg.fallbackModel}`
      );
    }
    model = cfg.fallbackModel;
  }

  const systemPrompt =
    Array.isArray(cfg.systemPromptLines)
      ? cfg.systemPromptLines.join('\n')
      : '';

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
    [...messages].reverse().find(m => m.role === 'user')?.content ?? '';

  const routing = await routeIntent(userInput);

  if (DEBUG) {
    console.log(
      `[router] intent=${routing.intent} confidence=${routing.confidence}`
    );
  }

  const { model, messages: cleanMessages } =
    selectAndBuildPrompt(routing.intent, userInput);

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
function toOpenAIChatCompletion(json: OllamaChatResponse, model: string) {
  return {
    id: `chatcmpl-local-${Date.now()}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
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
  res.write(`data: [DONE]\n\n`);
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
      return res.json(await upstream.json());
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive'
    });

    const reader = upstream.body!.getReader();

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          // 這裡維持 Ollama 原生 stream，不轉 OpenAI schema
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
      return res.json(toOpenAIChatCompletion(json, plan.model));
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no'
    });

    const reader = upstream.body!.getReader();
    const decoder = new TextDecoder();

    let buffer = '';

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

          const parsed = JSON.parse(trimmed) as OllamaChatResponse;
          const content = parsed.message?.content ?? '';

          if (content) {
            writeOpenAIStreamChunk(res, plan.model, content);
          }

          if (parsed.done) {
            writeOpenAIStreamDone(res, plan.model);
          }
        }
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
  const upstream = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ...req.body,
      model: 'nomic-embed-text'
    })
  });

  res.json(await upstream.json());
});

/**
 * =====================
 * OpenAI-compatible Embeddings alias
 * =====================
 */
app.post('/v1/embeddings', async (req, res) => {
  const upstream = await fetch(`${OLLAMA_BASE}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: req.body.input,
      model: 'nomic-embed-text'
    })
  });

  const json = await upstream.json();

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
});

/**
 * =====================
 * Health
 * =====================
 */
app.get('/health', (_, res) => {
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Ollama router running at http://localhost:${PORT}`);
  console.log(`Node 20 / TS6 / Node16 module mode`);
  console.log(`DEBUG=${DEBUG}`);

  // 啟動後立即非同步預載，不阻塞 server 啟動
  preloadModels().catch(err => {
    console.error('[preload] failed', err);
  });
});
