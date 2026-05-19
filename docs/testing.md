# 測試案例說明

本文整理目前 `__tests__/router.test.ts` 中的 Jest 測試案例，方便後續維護 router core 與 mutation testing baseline。

## 測試範圍

目前測試聚焦在不需要啟動 Express server、也不需要連線 Ollama 的 router core 行為：

- router 輸出正規化
- router JSON 解析
- legacy `intent` 欄位相容性
- model policy 解析
- single-model gate 判斷
- OpenAI-compatible response mapping

## Router Result Normalization

### 接受已知 task type，未知值回退到 `analysis`

確認 `normalizeTaskType()` 對合法 task type 會保留原值，例如 `coding`；若收到未知字串或 `undefined`，會安全回退到 `analysis`。

### 將 confidence 限制在 `0..1`

確認 `normalizeConfidence()` 只接受數字，並將結果限制在 `0` 到 `1` 之間：

- `0.75` 保持 `0.75`
- 大於 `1` 的值會變成 `1`
- 小於 `0` 的值會變成 `0`
- 非數字值會變成 `0`

### 解析 `task_type` 與 legacy `intent`

確認 `safeParseRouterResult()` 可以解析新版 router 輸出的 `task_type`，也能支援舊版輸出的 `intent` 欄位，維持 v1.0.0 到 v1.1.0 的相容性。

### 非 JSON 輸出安全回退

確認 router 模型輸出不是合法 JSON 時，`safeParseRouterResult()` 會回傳安全預設值：

- `task_type`: `analysis`
- `confidence`: `0`
- `reason`: `router output is not valid JSON`

## Model Policy Resolution

### 解析 primary 與 fallback model policy

確認 `resolvePrimaryModel()` 與 `resolveFallbackModel()` 會依照 `intent-config.json` 回傳預期模型。例如：

- `analysis` primary 為 `mistral:7b-instruct`
- `analysis` fallback 為 `phi3:mini`
- `short_question` primary 為 `gemma3:1b`
- `short_question` fallback 為 `llama3.2:3b`

### 預載 router model 不視為執行中的 generation model

確認 `hasRunningGenerationModel()` 在 `ollama ps` 只看到預載 router model，例如 `phi3:mini` 時，會回傳 `false`，避免 single-model gate 誤判。

### 偵測非 router 的 generation model

確認 `hasRunningGenerationModel()` 在 `ollama ps` 同時看到 router model 與其他 generation model，例如 `mistral:7b-instruct` 時，會回傳 `true`。

### single-model gate 啟動時使用 fallback model

確認 `selectAndBuildPrompt()` 在偵測到已有 generation model 執行時，會從 primary model 切換到較輕量或 fallback 的模型。例如 `draft_generation` 會從 `mistral:7b-instruct` 切到 `phi3:mini`。

此案例也確認 prompt builder 會保留：

- task-specific system prompt
- 使用者輸入訊息

## OpenAI-Compatible Response Mapping

### 保留 model、content、usage 與 router metadata

確認 `toOpenAIChatCompletion()` 會把 Ollama response 轉成 OpenAI-compatible chat completion 格式，並保留：

- `model`
- assistant 回覆內容
- token usage
- `router.task_type`
- `router.confidence`
- `router.reason`

## 執行測試

```bash
npm test
```

需要避免平行執行造成除錯噪音時，可以使用：

```bash
npm test -- --runInBand
```

## 執行 TypeScript 檢查

```bash
npm run build
```

## 執行 Mutation Testing

```bash
npm run test:mutation
```

目前 Stryker mutation testing 範圍刻意限制在已由 Jest 覆蓋的 router core/helper 區段，尚未納入 Express route handlers 與 server startup code。
