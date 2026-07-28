import type { WebEvidence } from '@/lib/ai/types'
import { createHash } from 'node:crypto'

const MAX_RESULTS = 8
const MAX_SNIPPET = 1200
const TIMEOUT_MS = 8_000

export interface WebSearchProvider {
  readonly name: string
  search(query: string, options?: { limit?: number }): Promise<WebEvidence[]>
}

function validHttpUrl(value: string): string | null {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null } catch { return null }
}

function domainOf(url: string): string {
  try { return new URL(url).hostname.replace(/^www\./u, '') } catch { return 'web' }
}

export class NullWebSearchProvider implements WebSearchProvider {
  readonly name = 'unavailable'
  async search(): Promise<WebEvidence[]> { return [] }
}

export class TavilyCompatibleProvider implements WebSearchProvider {
  constructor(private endpoint: string, private apiKey: string, readonly name = 'tavily') {}

  async search(query: string, options: { limit?: number } = {}): Promise<WebEvidence[]> {
    const limit = Math.max(1, Math.min(MAX_RESULTS, options.limit ?? 5))
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS)
    const queryFingerprint = createHash('sha256').update(query).digest('hex').slice(0, 10)
    console.info('Web search', { provider: this.name, queryFingerprint, queryLength: query.length, limit })
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify({ api_key: this.apiKey, query, max_results: limit, include_answer: false, search_depth: 'advanced' }),
      })
      if (!response.ok) return []
      const data = await response.json() as { results?: Array<{ title?: unknown; url?: unknown; content?: unknown; snippet?: unknown; published_date?: unknown }> }
      const retrievedAt = new Date().toISOString()
      return (data.results ?? []).slice(0, limit).flatMap((item) => {
        const url = typeof item.url === 'string' ? validHttpUrl(item.url) : null
        const snippet = typeof item.content === 'string' ? item.content : typeof item.snippet === 'string' ? item.snippet : ''
        if (!url || !snippet.trim()) return []
        return [{ title: typeof item.title === 'string' ? item.title.trim().slice(0, 300) || domainOf(url) : domainOf(url), url, snippet: snippet.normalize('NFKC').trim().slice(0, MAX_SNIPPET), source: domainOf(url), publishedAt: typeof item.published_date === 'string' ? item.published_date.slice(0, 40) : null, retrievedAt, provider: this.name }]
      })
    } catch (error) {
      console.warn('Web search unavailable', { provider: this.name, reason: error instanceof DOMException && error.name === 'AbortError' ? 'timeout' : 'request_failed' })
      return []
    } finally { clearTimeout(timeout) }
  }
}

let cachedProvider: WebSearchProvider | null = null
export function getWebSearchProvider(): WebSearchProvider {
  if (cachedProvider) return cachedProvider
  const endpoint = process.env.WEB_SEARCH_API_URL
  const apiKey = process.env.WEB_SEARCH_API_KEY
  cachedProvider = endpoint && apiKey ? new TavilyCompatibleProvider(endpoint, apiKey, process.env.WEB_SEARCH_PROVIDER ?? 'tavily') : new NullWebSearchProvider()
  return cachedProvider
}

export function webProviderStatus(enabled = true) {
  if (!enabled) return { status: 'DISABLED' as const, label: 'Web enrichment disabled by user' }
  const provider = getWebSearchProvider()
  return provider.name === 'unavailable' || provider.name.startsWith('null') ? { status: 'UNAVAILABLE' as const, label: 'Web search unavailable' } : { status: 'CONFIGURED' as const, label: 'Web search configured', provider: provider.name }
}

export function __setWebSearchProvider(provider: WebSearchProvider | null): void { cachedProvider = provider }
