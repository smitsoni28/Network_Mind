import 'dotenv/config'
import { openRouterRoleConfig, type LlmRole } from '../lib/ai/llm'

type RoleResult = {
  role: LlmRole
  configuredModel: string
  servingModel: string | null
  latencyMs: number
  ok: boolean
  status: 'ok' | 'missing_api_key' | 'http_error' | 'timeout' | 'empty_result' | 'json_failure' | 'schema_validation_failure' | 'provider_error'
  detail: string
}

const roles: LlmRole[] = ['planner', 'conversation', 'research']
const baseUrl = (process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1').replace(/\/+$/u, '')
const apiKey = process.env.OPENROUTER_API_KEY
const referer = process.env.OPENROUTER_SITE_URL ?? 'http://localhost:3000'
const title = process.env.OPENROUTER_APP_NAME ?? 'NetworkMind'

function rolePrompt(role: LlmRole) {
  return {
    system: 'Return one compact JSON object only. No markdown.',
    user: `Health check role: ${role}. Return {"ok":true,"role":"${role}","summary":"ready"}.`,
  }
}

function classifyPayload(content: string, role: LlmRole): Pick<RoleResult, 'ok' | 'status' | 'detail'> {
  if (!content.trim()) return { ok: false, status: 'empty_result', detail: 'The provider returned an empty message.' }
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    return { ok: false, status: 'json_failure', detail: 'The model message was not valid JSON.' }
  }
  if (!parsed || typeof parsed !== 'object' || (parsed as { ok?: unknown }).ok !== true || (parsed as { role?: unknown }).role !== role) {
    return { ok: false, status: 'schema_validation_failure', detail: 'The model JSON did not match the expected health-check schema.' }
  }
  return { ok: true, status: 'ok', detail: 'Role responded with valid JSON.' }
}

async function checkRole(role: LlmRole): Promise<RoleResult> {
  const config = openRouterRoleConfig(role, Math.min(openRouterRoleConfig(role).maxTokens, 320))
  const started = Date.now()
  if (!apiKey) {
    return { role, configuredModel: config.model, servingModel: null, latencyMs: 0, ok: false, status: 'missing_api_key', detail: 'OPENROUTER_API_KEY is not configured.' }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), Math.min(config.timeoutMs, 15_000))
  const prompt = rolePrompt(role)
  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
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
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: prompt.system },
          { role: 'user', content: prompt.user },
        ],
      }),
    })
    const latencyMs = Date.now() - started
    let payload: { model?: string; choices?: Array<{ message?: { content?: string } }>; error?: { message?: string } }
    try {
      payload = await response.json()
    } catch {
      return { role, configuredModel: config.model, servingModel: null, latencyMs, ok: false, status: 'json_failure', detail: `HTTP ${response.status}; response body was not JSON.` }
    }
    if (!response.ok) {
      return { role, configuredModel: config.model, servingModel: payload.model ?? null, latencyMs, ok: false, status: 'http_error', detail: `HTTP ${response.status}: ${payload.error?.message ?? response.statusText}` }
    }
    if (payload.error?.message) {
      return { role, configuredModel: config.model, servingModel: payload.model ?? null, latencyMs, ok: false, status: 'provider_error', detail: payload.error.message }
    }
    const classified = classifyPayload(payload.choices?.[0]?.message?.content ?? '', role)
    return { role, configuredModel: config.model, servingModel: payload.model ?? null, latencyMs, ...classified }
  } catch (error) {
    const latencyMs = Date.now() - started
    const timeoutError = error instanceof DOMException && error.name === 'AbortError'
    return { role, configuredModel: config.model, servingModel: null, latencyMs, ok: false, status: timeoutError ? 'timeout' : 'http_error', detail: timeoutError ? 'OpenRouter request timed out.' : error instanceof Error ? error.message : 'OpenRouter request failed.' }
  } finally {
    clearTimeout(timeout)
  }
}

async function main() {
  const results = await Promise.all(roles.map((role) => checkRole(role)))
  for (const result of results) {
    const label = result.ok ? 'PASS' : 'FAIL'
    console.log(`${label} ${result.role}: configured=${result.configuredModel} serving=${result.servingModel ?? 'unknown'} latency=${result.latencyMs}ms status=${result.status}`)
    console.log(`  ${result.detail}`)
  }

  if (results.some((result) => !result.ok)) process.exitCode = 1
}

void main()
