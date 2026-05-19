import { callLlmProvider } from './provider.js';
import { validateAgentResponse } from './validation.js';

export async function respondToAgentRequest(request, config) {
  const rawResponse = await callLlmProvider(request, config);
  return validateAgentResponse(rawResponse, request);
}
