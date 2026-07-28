/**
 * Server-side only. This module reads OPENROUTER_API_KEY from the environment
 * and must never be imported into a Client Component. It is reached exclusively
 * through `lib/ai/run-llm.ts`, which is only used by API route handlers, so the
 * key is never bundled for or exposed to the client.
 *
 * Error raised for LLM provider / network / configuration failures.
 * These are NOT retried by the structured runner.
 */
export class LlmError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'LlmError'
    this.status = status
  }
}

const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1'
const DEFAULT_MODEL = 'openai/gpt-4o-mini'
export type LlmRole = 'planner' | 'conversation' | 'research'

const ROLE_ENV: Record<LlmRole, { model: string; maxTokens: string; timeout: string; hardMax: number; fallback: number }> = {
  planner: { model: 'OPENROUTER_PLANNER_MODEL', maxTokens: 'OPENROUTER_PLANNER_MAX_TOKENS', timeout: 'OPENROUTER_PLANNER_TIMEOUT_MS', hardMax: 2_000, fallback: 1_200 },
  conversation: { model: 'OPENROUTER_CONVERSATION_MODEL', maxTokens: 'OPENROUTER_CONVERSATION_MAX_TOKENS', timeout: 'OPENROUTER_CONVERSATION_TIMEOUT_MS', hardMax: 3_000, fallback: 1_800 },
  research: { model: 'OPENROUTER_RESEARCH_MODEL', maxTokens: 'OPENROUTER_RESEARCH_MAX_TOKENS', timeout: 'OPENROUTER_RESEARCH_TIMEOUT_MS', hardMax: 5_000, fallback: 3_500 },
}

function positiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback
}

export function openRouterRoleConfig(role: LlmRole = 'conversation', overrideMaxTokens?: number) {
  const env = ROLE_ENV[role]
  const configuredModel = process.env[env.model] || process.env.OPENROUTER_MODEL || DEFAULT_MODEL
  const configuredMax = overrideMaxTokens ?? positiveInt(process.env[env.maxTokens], env.fallback)
  return {
    role,
    model: configuredModel,
    maxTokens: Math.max(1, Math.min(env.hardMax, configuredMax)),
    timeoutMs: positiveInt(process.env[env.timeout], role === 'research' ? 40_000 : role === 'conversation' ? 30_000 : 15_000),
  }
}

/**
 * Calls the configured OpenRouter model and returns the raw text content.
 *
 * Provider-agnostic for callers: the structured runner only depends on
 * `callLLM` returning a string (or throwing `LlmError`).
 */
export async function callLLM(system: string, user: string, options: { role?: LlmRole; maxTokens?: number } = {}): Promise<string> {
  const apiKey = process.env.OPENROUTER_API_KEY
  if (!apiKey) {
    throw new LlmError('OPENROUTER_API_KEY is not configured', 500)
  }

  const baseUrl = (process.env.OPENROUTER_BASE_URL ?? DEFAULT_BASE_URL).replace(
    /\/+$/,
    '',
  )
  const config = openRouterRoleConfig(options.role, options.maxTokens)

  // OpenRouter ranking/attribution metadata. Optional per OpenRouter docs;
  // defaulted so the headers are always present without requiring extra env.
  const referer = process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000'
  const title = process.env.OPENROUTER_APP_NAME ?? 'NetworkMind'

  let response: Response
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs)
  try {
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'HTTP-Referer': referer,
        'X-Title': title,
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: config.maxTokens,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    })
  } catch (error) {
    const message =
      error instanceof DOMException && error.name === 'AbortError'
        ? 'OpenRouter request timed out'
        : error instanceof Error
        ? error.message
        : 'Network request to OpenRouter failed'
    throw new LlmError(`OpenRouter network error: ${message}`, 502)
  } finally {
    clearTimeout(timeout)
  }

  if (!response.ok) {
    const errorText = await response.text().catch(() => '')
    if (response.status === 429) {
      throw new LlmError(
        'OpenRouter rate limit reached. Please try again shortly.',
        429,
      )
    }
    if (response.status === 401 || response.status === 403) {
      throw new LlmError(
        'OpenRouter rejected the API key (unauthorized).',
        401,
      )
    }
    throw new LlmError(
      `OpenRouter API error (${response.status}): ${errorText}`,
      502,
    )
  }

  let data: {
    choices?: Array<{ message?: { content?: string } }>
    error?: { message?: string }
  }
  try {
    data = await response.json()
  } catch {
    throw new LlmError('OpenRouter returned a non-JSON response', 502)
  }

  // OpenRouter can return HTTP 200 with an embedded provider error.
  if (data.error?.message) {
    throw new LlmError(`OpenRouter provider error: ${data.error.message}`, 502)
  }

  const content = data.choices?.[0]?.message?.content
  if (!content || !content.trim()) {
    throw new LlmError('OpenRouter returned an empty response', 502)
  }

  return content
}
