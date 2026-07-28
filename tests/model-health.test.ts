import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

describe('model health-check wiring', () => {
  it('exposes check:models and attempts all required OpenRouter roles', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as { scripts?: Record<string, string> }
    const script = readFileSync('scripts/check-openrouter.ts', 'utf8')
    const llm = readFileSync('lib/ai/llm.ts', 'utf8')

    expect(pkg.scripts?.['check:models']).toBe('node --import tsx scripts/check-openrouter.ts')
    expect(script).toContain("const roles: LlmRole[] = ['planner', 'conversation', 'research']")
    expect(script).toContain('max_tokens')
    expect(script).toContain('Promise.all')
    expect(script).toContain('process.exitCode = 1')
    expect(llm).toContain('OPENROUTER_PLANNER_MAX_TOKENS')
    expect(llm).toContain('OPENROUTER_CONVERSATION_MAX_TOKENS')
    expect(llm).toContain('OPENROUTER_RESEARCH_MAX_TOKENS')
    expect(llm).toContain('max_tokens: config.maxTokens')
  })
})
