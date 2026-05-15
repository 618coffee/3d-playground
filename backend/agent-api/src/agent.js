import { createMockAgentResponse } from './mock-agent.js';
import { callLlmProvider } from './provider.js';
import { validateAgentResponse } from './validation.js';

export async function respondToAgentRequest(request, config) {
  const rawResponse = config.agentMode === 'llm'
    ? await callLlmProvider(request, config)
    : createMockAgentResponse(request);
  return validateAgentResponse(rawResponse, request);
}
