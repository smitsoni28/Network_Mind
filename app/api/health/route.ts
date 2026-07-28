import { NextResponse } from 'next/server'
import { db } from '@/lib/db'

const requiredTables = ['Workspace', 'Contact', 'Recommendation'] as const

export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`
    const tables = await db.$queryRaw<Array<{ table_name: string }>>`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('Workspace', 'Contact', 'Recommendation')
    `
    const present = new Set(tables.map((table) => table.table_name))
    const missingTables = requiredTables.filter((table) => !present.has(table))
    return NextResponse.json({
      app: 'ok',
      database: {
        reachable: true,
        basicSchemaAvailable: missingTables.length === 0,
        missingTables,
      },
    }, { status: missingTables.length === 0 ? 200 : 503 })
  } catch (error) {
    console.error('Health check database probe failed', error instanceof Error ? error.message : error)
    return NextResponse.json({
      app: 'ok',
      database: {
        reachable: false,
        basicSchemaAvailable: false,
      },
    }, { status: 503 })
  }
}
