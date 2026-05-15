import http from 'node:http';
import { readConfig } from './config.js';
import { errorBody, toHttpError } from './errors.js';
import { respondToAgentRequest } from './agent.js';
import { validateAgentRequest } from './validation.js';

const config = readConfig();

const server = http.createServer(async (request, response) => {
  try {
    applyCors(request, response, config);
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    if (request.method === 'GET' && request.url === '/health') {
      sendJson(response, 200, { ok: true, mode: config.agentMode });
      return;
    }

    if (request.method === 'POST' && request.url === '/api/agent/respond') {
      const body = await readJsonBody(request);
      const agentRequest = validateAgentRequest(body);
      const agentResponse = await respondToAgentRequest(agentRequest, config);
      sendJson(response, 200, agentResponse);
      return;
    }

    sendJson(response, 404, { error: { code: 'not_found', message: 'Route not found.' } });
  } catch (error) {
    const httpError = toHttpError(error);
    sendJson(response, httpError.status, errorBody(httpError));
  }
});

server.listen(config.port, config.host, () => {
  console.log(`agent-api listening on http://${config.host}:${config.port} (${config.agentMode})`);
});

function applyCors(request, response, appConfig) {
  const origin = request.headers.origin;
  if (origin && appConfig.corsOrigins.includes(origin)) {
    response.setHeader('Access-Control-Allow-Origin', origin);
    response.setHeader('Vary', 'Origin');
  }
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function sendJson(response, status, payload) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(payload));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_000_000) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
