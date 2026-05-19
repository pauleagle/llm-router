import { describe, expect, test } from '@jest/globals';
import {
  GenerationPlan,
  hasRunningGenerationModel,
  normalizeConfidence,
  normalizeTaskType,
  resolveFallbackModel,
  resolvePrimaryModel,
  safeParseRouterResult,
  selectAndBuildPrompt,
  toOpenAIChatCompletion
} from '../server';

describe('router result normalization', () => {
  test('accepts known task types and falls back to analysis for unknown values', () => {
    expect(normalizeTaskType('coding')).toBe('coding');
    expect(normalizeTaskType('not_a_task')).toBe('analysis');
    expect(normalizeTaskType(undefined)).toBe('analysis');
  });

  test('clamps confidence to the 0..1 range', () => {
    expect(normalizeConfidence(0.75)).toBe(0.75);
    expect(normalizeConfidence(2)).toBe(1);
    expect(normalizeConfidence(-1)).toBe(0);
    expect(normalizeConfidence('0.9')).toBe(0);
  });

  test('parses task_type and legacy intent router output', () => {
    expect(
      safeParseRouterResult(
        JSON.stringify({ task_type: 'debug', confidence: 0.9, reason: 'log analysis' })
      )
    ).toEqual({
      task_type: 'debug',
      confidence: 0.9,
      reason: 'log analysis'
    });

    expect(
      safeParseRouterResult(JSON.stringify({ intent: 'summarization', confidence: 0.5 }))
    ).toMatchObject({
      task_type: 'summarization',
      confidence: 0.5
    });
  });

  test('falls back safely when router output is not valid JSON', () => {
    expect(safeParseRouterResult('not json')).toEqual({
      task_type: 'analysis',
      confidence: 0,
      reason: 'router output is not valid JSON'
    });
  });
});

describe('model policy resolution', () => {
  test('resolves primary and fallback policy from intent config', () => {
    expect(resolvePrimaryModel('analysis')).toBe('mistral:7b-instruct');
    expect(resolveFallbackModel('analysis')).toBe('phi3:mini');
    expect(resolvePrimaryModel('short_question')).toBe('gemma3:1b');
    expect(resolveFallbackModel('short_question')).toBe('llama3.2:3b');
  });

  test('does not treat the preloaded router model as a running generation model', () => {
    expect(
      hasRunningGenerationModel(
        'NAME ID SIZE PROCESSOR UNTIL\nphi3:mini abc 2.2GB 100% 10 minutes\n'
      )
    ).toBe(false);
  });

  test('detects running non-router generation models', () => {
    expect(
      hasRunningGenerationModel(
        [
        'NAME ID SIZE PROCESSOR UNTIL',
        'phi3:mini abc 2.2GB 100% 10 minutes',
        'mistral:7b-instruct def 4.1GB 100% 10 minutes'
        ].join('\n')
      )
    ).toBe(true);
  });

  test('uses fallback model when the single-model gate detects another generation model', () => {
    const plan = selectAndBuildPrompt(
      'draft_generation',
      'Write a release note.',
      true
    );

    expect(plan.model).toBe('phi3:mini');
    expect(plan.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ role: 'system' }),
        { role: 'user', content: 'Write a release note.' }
      ])
    );
  });
});

describe('OpenAI-compatible response mapping', () => {
  test('preserves model, content, token usage, and router metadata', () => {
    const plan: GenerationPlan = {
      model: 'mistral:7b-instruct',
      messages: [{ role: 'user', content: 'hello' }],
      routing: { task_type: 'analysis', confidence: 0.8, reason: 'needs reasoning' }
    };

    expect(
      toOpenAIChatCompletion(
        {
          message: { role: 'assistant', content: 'hi there' },
          prompt_eval_count: 3,
          eval_count: 4
        },
        plan
      )
    ).toMatchObject({
      object: 'chat.completion',
      model: 'mistral:7b-instruct',
      choices: [
        {
          index: 0,
          message: { role: 'assistant', content: 'hi there' },
          finish_reason: 'stop'
        }
      ],
      usage: {
        prompt_tokens: 3,
        completion_tokens: 4,
        total_tokens: 7
      },
      router: {
        task_type: 'analysis',
        confidence: 0.8,
        reason: 'needs reasoning'
      }
    });
  });
});
