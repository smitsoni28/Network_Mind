import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { pathToFileURL } from 'node:url'

type WaitForDatabaseOptions = {
  databaseUrl?: string
  timeoutMs?: number
  intervalMs?: number
  query?: () => Promise<unknown>
  now?: () => number
  sleep?: (ms: number) => Promise<void>
  log?: (message: string) => void
}

type WaitForDatabaseResult = { attempts: number; elapsedMs: number }

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

export async function waitForDatabase(options: WaitForDatabaseOptions = {}): Promise<WaitForDatabaseResult> {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure the local PostgreSQL URL.')

  const timeoutMs = options.timeoutMs ?? positiveNumber(process.env.DB_WAIT_TIMEOUT_MS, 60_000)
  const intervalMs = options.intervalMs ?? positiveNumber(process.env.DB_WAIT_INTERVAL_MS, 1000)
  const now = options.now ?? Date.now
  const sleep = options.sleep ?? delay
  const log = options.log ?? console.info
  const query = options.query
  if (!query) throw new Error('waitForDatabase requires a query function.')

  const startedAt = now()
  const deadline = startedAt + timeoutMs
  let attempts = 0
  let lastError = 'database did not respond'

  log(`Waiting for database readiness with a ${Math.ceil(timeoutMs / 1000)}s timeout...`)
  while (now() <= deadline) {
    attempts += 1
    try {
      await query()
      const elapsedMs = now() - startedAt
      log(`Database is ready after ${attempts} attempt${attempts === 1 ? '' : 's'} (${elapsedMs}ms).`)
      return { attempts, elapsedMs }
    } catch (error) {
      lastError = errorMessage(error)
      const remainingMs = deadline - now()
      if (remainingMs <= 0) break
      log(`Database is not ready yet (attempt ${attempts}): ${lastError}`)
      await sleep(Math.min(intervalMs, remainingMs))
    }
  }

  throw new Error(`Database did not become ready within ${Math.ceil(timeoutMs / 1000)}s. Last error: ${lastError}`)
}

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  const client = new PrismaClient({ datasources: databaseUrl ? { db: { url: databaseUrl } } : undefined })
  try {
    await waitForDatabase({ databaseUrl, query: () => client.$queryRaw`SELECT 1` })
  } finally {
    await client.$disconnect()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(errorMessage(error))
    process.exitCode = 1
  })
}
