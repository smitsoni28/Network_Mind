import { callLLM, LlmError, type LlmRole } from '@/lib/ai/llm'

export type Validated<T> =
  | { ok: true; data: T }
  | { ok: false; errors: string[] }

export type LlmRunResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: number; error: string; details?: string[] }

/**
 * Runs a structured (JSON) LLM call.
 *
 * Retry policy:
 * - Retries ONLY when the model returns invalid JSON or fails validation.
 * - Does NOT retry on provider/network/rate-limit/missing-key errors; those
 *   return immediately with a clear error.
 */
export async function runStructuredLlm<T>({
  system,
  user,
  validate,
  maxAttempts = 2,
  role = 'conversation',
  maxTokens,
}: {
  system: string
  user: string
  validate: (data: unknown) => Validated<T>
  maxAttempts?: number
  role?: LlmRole
  maxTokens?: number
}): Promise<LlmRunResult<T>> {
  let lastErrors: string[] = ['Model response failed validation']

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    let content: string

    try {
      content = await callLLM(system, user, { role, maxTokens })
    } catch (error) {
      // API / network / rate-limit / missing-key failure: do not retry.
      if (error instanceof LlmError) {
        return { ok: false, status: error.status, error: error.message }
      }
      const message =
        error instanceof Error ? error.message : 'LLM request failed'
      return { ok: false, status: 502, error: message }
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      lastErrors = ['Model returned invalid JSON']
      continue // retry
    }

    const result = validate(parsed)
    if (result.ok) {
      return { ok: true, data: result.data }
    }

    lastErrors = result.errors // retry
  }

  return {
    ok: false,
    status: 502,
    error: 'Model response failed validation after retry',
    details: lastErrors,
  }
}
