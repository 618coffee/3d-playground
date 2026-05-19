import test from 'node:test';
import assert from 'node:assert/strict';
import { readConfig } from './config.js';

test('defaults to the LLM provider mode', () => {
  const config = readConfig({});

  assert.equal(config.agentMode, 'llm');
});

test('ignores legacy AGENT_MODE environment values', () => {
  const config = readConfig({ AGENT_MODE: 'anything' });

  assert.equal(config.agentMode, 'llm');
});

test('infers Azure AI inference for Cognitive Services OpenAI endpoints', () => {
  const config = readConfig({
    LLM_BASE_URL: 'https://example-resource.cognitiveservices.azure.com/',
    LLM_API_KEY: 'test-key',
  });

  assert.equal(config.llm.provider, 'azure-ai-inference');
  assert.equal(config.llm.authHeader, 'api-key');
  assert.equal(config.llm.baseUrl, 'https://example-resource.cognitiveservices.azure.com');
});