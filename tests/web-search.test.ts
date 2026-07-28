import { afterEach, describe, expect, it, vi } from 'vitest'
import { TavilyCompatibleProvider } from '@/lib/tools/web-search'
describe('web provider', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('returns bounded valid sources', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ title: 'Source', url: 'https://example.com/a', content: 'Grounded '.repeat(300), published_date: '2026-01-01' }] }), { status: 200 }))); const items = await new TavilyCompatibleProvider('https://api.example.test', 'key').search('question'); expect(items[0].url).toBe('https://example.com/a'); expect(items[0].snippet.length).toBeLessThanOrEqual(1200) })
  it('drops unsafe URLs', async () => { vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: [{ url: 'javascript:alert(1)', content: 'bad' }] }), { status: 200 }))); expect(await new TavilyCompatibleProvider('https://api.example.test', 'key').search('question')).toEqual([]) })
  it('handles provider failures safely', async () => { vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('secret stack'))); expect(await new TavilyCompatibleProvider('https://api.example.test', 'key').search('question')).toEqual([]) })
})
