const DEFAULT_CORS_ORIGINS = ['http://127.0.0.1:5173', 'http://localhost:5173'];

export function readConfig(env = process.env) {
  const port = parsePort(env.PORT ?? env.AGENT_API_PORT, 8787);
  const baseUrl = stripTrailingSlash(env.LLM_BASE_URL || 'https://api.openai.com/v1');
  const provider = env.LLM_PROVIDER || inferProvider(baseUrl);

  return {
    host: env.HOST || '0.0.0.0',
    port,
    agentMode: 'llm',
    corsOrigins: parseCsv(env.CORS_ORIGINS ?? env.CORS_ORIGIN, DEFAULT_CORS_ORIGINS),
    llm: {
      provider,
      apiKey: env.LLM_API_KEY || '',
      baseUrl,
      model: env.LLM_MODEL || 'gpt-4.1-mini',
      apiVersion: env.LLM_API_VERSION || env.AZURE_OPENAI_API_VERSION || '2024-05-01-preview',
      authHeader: env.LLM_AUTH_HEADER || inferAuthHeader(provider),
      accessToken: env.LLM_ACCESS_TOKEN || '',
      timeoutMs: parsePositiveInteger(env.LLM_TIMEOUT_MS, 30000),
    },
  };
}

function inferProvider(baseUrl) {
  if (/\.openai\.azure\.com/i.test(baseUrl)) return 'azure-openai';
  if (/\.cognitiveservices\.azure\.com/i.test(baseUrl)) return 'azure-ai-inference';
  if (/\.services\.ai\.azure\.com/i.test(baseUrl)) return 'azure-ai-inference';
  return 'openai-compatible';
}

function inferAuthHeader(provider) {
  return provider === 'azure-openai' || provider === 'azure-ai-inference' ? 'api-key' : 'authorization';
}

function parseCsv(value, fallback) {
  if (!value) return fallback;
  const items = value.split(',').map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : fallback;
}

function parsePort(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : fallback;
}

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function stripTrailingSlash(value) {
  return value.replace(/\/+$/, '');
}
