import OpenAI, { AzureOpenAI } from 'openai';
import { HttpError } from './errors.js';
import { AGENT_RESPONSE_SCHEMA, OPERATION_COMMAND_SCHEMA, ACTION_RISK_SCHEMA } from './schema.js';

export async function callLlmProvider(request, config) {
  if (!config.llm.apiKey && !config.llm.accessToken) {
    throw new HttpError(500, 'missing_llm_credentials', 'LLM_API_KEY or LLM_ACCESS_TOKEN is required when AGENT_MODE=llm.');
  }

  try {
    const client = createClient(config.llm);
    const completion = await client.chat.completions.create({
      model: config.llm.model,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: systemPrompt() },
        { role: 'user', content: JSON.stringify(buildProviderPayload(request)) },
      ],
    });

    const content = completion.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      throw new HttpError(502, 'invalid_llm_payload', 'LLM provider response did not include message content.');
    }
    return parseProviderJson(content, 'LLM provider returned non-JSON content.');
  } catch (error) {
    throw toProviderError(error);
  }
}

function createClient(llmConfig) {
  if (llmConfig.provider === 'azure-openai') {
    const authOptions = llmConfig.accessToken
      ? { azureADTokenProvider: async () => llmConfig.accessToken }
      : { apiKey: llmConfig.apiKey };
    return new AzureOpenAI({
      ...authOptions,
      endpoint: llmConfig.baseUrl,
      apiVersion: llmConfig.apiVersion,
      timeout: llmConfig.timeoutMs,
      maxRetries: 0,
    });
  }

  return new OpenAI({
    apiKey: llmConfig.accessToken || llmConfig.apiKey,
    baseURL: providerBaseUrl(llmConfig),
    defaultHeaders: providerHeaders(llmConfig),
    timeout: llmConfig.timeoutMs,
    maxRetries: 0,
  });
}

function providerBaseUrl(llmConfig) {
  const baseUrl = llmConfig.baseUrl.replace(/\/+$/, '');
  if (llmConfig.provider === 'azure-ai-inference') {
    // Azure AI Inference exposes OpenAI-compatible chat completions under /openai/v1. Normalize resource,
    // /openai, and /openai/v1 inputs so config can use the endpoint shape users copy from Azure.
    if (/\/openai\/v1$/i.test(baseUrl)) return baseUrl;
    if (/\/openai$/i.test(baseUrl)) return `${baseUrl}/v1`;
    return `${baseUrl}/openai/v1`;
  }
  return baseUrl;
}

function providerHeaders(llmConfig) {
  if (llmConfig.accessToken) return undefined;
  if (llmConfig.authHeader === 'api-key') {
    // The OpenAI SDK normally sends Authorization: Bearer <apiKey>. Some Azure endpoints expect api-key
    // instead, so null explicitly removes Authorization while defaultHeaders adds the required header.
    return { Authorization: null, 'api-key': llmConfig.apiKey };
  }
  return undefined;
}

function parseProviderJson(text, message = 'LLM provider returned invalid JSON.') {
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(502, 'invalid_llm_json', message, text.slice(0, 500));
  }
}

function toProviderError(error) {
  if (error instanceof HttpError) return error;
  if (error instanceof OpenAI.APIError) {
    throw new HttpError(error.status ?? 502, 'llm_provider_error', `LLM provider returned ${error.status ?? 'an error'}.`, summarizeOpenAiError(error));
  }
  if (error?.name === 'APIConnectionTimeoutError') {
    throw new HttpError(504, 'llm_timeout', 'LLM provider request timed out.');
  }
  throw error;
}

function summarizeOpenAiError(error) {
  const providerError = error.error && typeof error.error === 'object' ? error.error : undefined;
  return {
    message: typeof providerError?.message === 'string' ? providerError.message : error.message,
    type: typeof providerError?.type === 'string' ? providerError.type : undefined,
    code: typeof providerError?.code === 'string' ? providerError.code : undefined,
    param: typeof providerError?.param === 'string' ? providerError.param : undefined,
    requestId: error.request_id,
  };
}

export function systemPrompt() {
  return [
    'You are a controlled CAD/CAE operation planner for a local browser workbench.',
    'Return only one JSON object matching AgentResponse. Do not include Markdown.',
    'Never execute code, call vtk.js, access files, or invent unsupported operation types.',
    'OperationCommand must be a flat object with type, target, params, source, rawText, and confirmed fields.',
    'Do not return common/commands wrapper objects for OperationCommand.',
    'Use only mesh ids from the scene context. Ask for clarification when target or parameters are ambiguous.',
    'Scene mesh entries may include color hex and colorLabel. Use colorLabel for requests like orange object, blue mesh, 橙色对象, or 蓝色网格; ask for clarification if more than one mesh matches.',
    'For move, translate, shift, 移动, or 平移 requests, return actionDraft with moveMesh and a relative offset vector in the current scene unit.',
    'For plane clip, cut, section, or slice requests that can be represented by a clipping plane, return actionDraft with clipMesh and mode applyVisualClip, not backendJobDraft.',
    'Map XY plane to normal [0,0,1], XZ plane to normal [0,1,0], and YZ plane to normal [1,0,0]. Phrases like whole model, entire model, 全部, 所有, or 整个模型 should target { source: "allVisible" }.',
    'Do not ask whether to use visual clipping or permanent geometry for simple plane clips; default to reversible visual clipping with cap true.',
    'Only return backendJobDraft for explicitly permanent, baked, boolean, exported, meshed, solver, or result-extraction work.',
    'Mode guidance is strict. Ask mode should answer questions about scene metadata, selected objects, operation history, supported capabilities, or pending state. In Ask mode, prefer message, clarification, or sceneAnswer and do not create executable operation drafts.',
    'Edit mode should produce at most one reviewed actionDraft for a concrete scene operation. If the user asks for multiple coordinated steps in Edit mode, ask them to switch to Agent mode.',
    'Agent mode may return actionPlan, macroDraft, or actionDraft, but every operation remains a reviewed draft and must not bypass confirmation.',
  ].join(' ');
}

export function buildProviderPayload(request) {
  // Send schemas with every request so the model drafts against the exact contract enforced below. This
  // keeps prompt guidance and server-side validation from drifting as OperationCommand evolves.
  return {
    text: request.text,
    mode: request.mode ?? 'edit',
    modelRouterId: request.modelRouterId ?? 'default-router',
    scene: request.scene,
    conversation: request.conversation,
    meshReferences: request.meshReferences ?? [],
    schemas: {
      agentResponse: AGENT_RESPONSE_SCHEMA,
      operationCommand: OPERATION_COMMAND_SCHEMA,
      actionRisk: ACTION_RISK_SCHEMA,
    },
  };
}
