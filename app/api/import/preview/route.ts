import { NextResponse } from 'next/server'
import { ApiError, errorResponse, secureRequest } from '@/lib/api'
import { MAX_CSV_BYTES, parseCsvText, summarizeCsvRows, toReviewRow, validateCsvRows } from '@/lib/services/csv-import'
import { loadContactImportKeys } from '@/lib/services/contact-service'

export async function POST(request: Request) {
  try {
    const session = await secureRequest(request, 'import-preview', 10)
    const data = await request.formData()
    const file = data.get('file')
    if (!(file instanceof File)) throw new ApiError(400, 'A CSV file is required')
    if (!file.name.toLowerCase().endsWith('.csv')) throw new ApiError(400, 'Only .csv files are accepted')
    if (file.size > MAX_CSV_BYTES) throw new ApiError(413, 'CSV file exceeds the 10 MB limit')
    if (file.type && !['text/csv', 'application/csv', 'application/vnd.ms-excel', 'text/plain'].includes(file.type)) throw new ApiError(400, 'The selected file is not a supported CSV type')
    const parsed = parseCsvText(await file.text())
    const existingKeys = await loadContactImportKeys(session.workspaceId)
    const validated = validateCsvRows(parsed.rows, parsed.mapping, existingKeys)
    const counts = summarizeCsvRows(validated, true)
    return NextResponse.json({ filename: file.name, headers: parsed.headers, delimiter: parsed.delimiter, mapping: parsed.mapping, rows: parsed.rows, preview: validated.slice(0, 50).map(toReviewRow), warnings: parsed.warnings, counts, existingKeys: [...existingKeys] })
  } catch (error) { return errorResponse(error) }
}
