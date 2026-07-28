import { describe, expect, it } from 'vitest'
import { waitForDatabase } from '@/scripts/wait-for-db'

describe('waitForDatabase', () => {
  it('succeeds after the database accepts a query', async () => {
    let currentTime = 0
    let attempts = 0
    const result = await waitForDatabase({
      databaseUrl: 'postgresql://user:pass@127.0.0.1:55432/db',
      timeoutMs: 5000,
      intervalMs: 1000,
      now: () => currentTime,
      sleep: async (ms) => { currentTime += ms },
      log: () => undefined,
      query: async () => {
        attempts += 1
        if (attempts < 3) throw new Error('not ready')
      },
    })

    expect(result).toEqual({ attempts: 3, elapsedMs: 2000 })
  })

  it('fails boundedly when the database never becomes reachable', async () => {
    let currentTime = 0
    await expect(waitForDatabase({
      databaseUrl: 'postgresql://user:pass@127.0.0.1:55432/db',
      timeoutMs: 2500,
      intervalMs: 1000,
      now: () => currentTime,
      sleep: async (ms) => { currentTime += ms },
      log: () => undefined,
      query: async () => { throw new Error('connection refused') },
    })).rejects.toThrow(/within 3s/)
  })

  it('fails clearly when DATABASE_URL is missing', async () => {
    const original = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      await expect(waitForDatabase({ query: async () => undefined, log: () => undefined })).rejects.toThrow(/DATABASE_URL/)
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = original
    }
  })
})
