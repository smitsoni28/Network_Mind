'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, UploadCloud, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { IMPORT_SKIP_REASON_LABELS, summarizeCsvRows, toReviewRow, validateCsvRows, type CsvField, type CsvImportSummary, type CsvMapping, type ImportSkipReasonCode, type RawCsvRow } from '@/lib/services/csv-import'

type Preview = {
  filename: string
  headers: string[]
  delimiter: string
  mapping: CsvMapping
  rows: RawCsvRow[]
  warnings: string[]
  counts: CsvImportSummary
  existingKeys: string[]
}
type ImportResult = {
  imported: number
  attempted: number
  skipped: number
  total: number
  valid: number
  warning: number
  invalid: number
  skippedByReason: Record<ImportSkipReasonCode, number>
  importJobId: string
}

const fields: Array<{ value: CsvField; label: string }> = [
  ['ignore', 'Ignore'], ['fullName', 'Full name'], ['firstName', 'First name'], ['lastName', 'Last name'], ['email', 'Email'], ['phone', 'Phone'], ['company', 'Company'], ['role', 'Role / title'], ['location', 'Location'], ['notes', 'Notes'], ['tags', 'Tags'], ['lastContactAt', 'Last contacted'], ['howMet', 'How we met'], ['relationshipStrength', 'Relationship strength'],
].map(([value, label]) => ({ value: value as CsvField, label }))

function skippedEntries(skippedByReason: Record<ImportSkipReasonCode, number>) {
  return Object.entries(skippedByReason).filter((entry): entry is [ImportSkipReasonCode, number] => entry[1] > 0)
}

export default function ImportPage() {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [mapping, setMapping] = useState<CsvMapping>({})
  const [includeWarnings, setIncludeWarnings] = useState(true)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<ImportResult | null>(null)
  const existingKeys = useMemo(() => new Set(preview?.existingKeys ?? []), [preview])
  const validated = useMemo(() => preview ? validateCsvRows(preview.rows, mapping, existingKeys) : [], [preview, mapping, existingKeys])
  const summary = useMemo(() => summarizeCsvRows(validated, includeWarnings), [validated, includeWarnings])

  async function choose(file: File) {
    setLoading(true)
    setError('')
    setResult(null)
    try {
      const form = new FormData()
      form.set('file', file)
      const response = await fetch('/api/import/preview', { method: 'POST', body: form })
      const data = await response.json() as Preview & { error?: string; details?: string[] }
      if (!response.ok) throw new Error([data.error, ...(data.details ?? [])].filter(Boolean).join(' - '))
      setPreview(data)
      setMapping(data.mapping)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'CSV could not be read')
    } finally {
      setLoading(false)
    }
  }

  async function confirm() {
    if (!preview) return
    setLoading(true)
    setError('')
    try {
      const response = await fetch('/api/import/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: preview.filename, mapping, includeWarnings, rows: validated.map(toReviewRow) }),
      })
      const data = await response.json() as ImportResult & { error?: string; details?: string[] }
      if (!response.ok) throw new Error([data.error, ...(data.details ?? [])].filter(Boolean).join(' - '))
      setResult(data)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Contacts could not be imported')
    } finally {
      setLoading(false)
    }
  }

  if (result) {
    const reasons = skippedEntries(result.skippedByReason)
    return <div className="mx-auto max-w-3xl px-4 py-12">
      <Card className="p-8 text-center">
        <CheckCircle2 className="mx-auto size-12 text-success" />
        <h1 className="mt-4 text-2xl font-semibold">{result.imported} contacts imported</h1>
        <p className="mt-2 text-sm text-muted-foreground">{result.skipped} skipped, {result.invalid} invalid, {result.attempted} attempted from {result.total} rows.</p>
        {reasons.length > 0 && <div className="mx-auto mt-5 max-w-md rounded-lg border p-4 text-left">
          <p className="text-sm font-semibold">Skipped rows</p>
          <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
            {reasons.map(([reason, count]) => <li key={reason} className="flex justify-between gap-4"><span>{IMPORT_SKIP_REASON_LABELS[reason]}</span><span>{count}</span></li>)}
          </ul>
        </div>}
        <details className="mx-auto mt-4 max-w-md text-left text-xs text-muted-foreground">
          <summary className="cursor-pointer">Import details</summary>
          <p className="mt-2">Import job ID: {result.importJobId}</p>
        </details>
        <Button className="mt-6" onClick={() => router.push('/')}>View your network</Button>
      </Card>
    </div>
  }

  return <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-10">
    <div>
      <h1 className="text-3xl font-semibold">Import contacts</h1>
      <p className="mt-2 text-muted-foreground">Upload a real CSV, review the mapping, and decide whether warning rows should be included.</p>
    </div>

    {!preview && <Card className="mt-7 p-8">
      <button type="button" onClick={() => inputRef.current?.click()} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const file = event.dataTransfer.files[0]; if (file) void choose(file) }} className="flex min-h-64 w-full flex-col items-center justify-center rounded-xl border-2 border-dashed p-8 text-center hover:border-primary">
        <UploadCloud className="size-10 text-primary" />
        <p className="mt-4 font-semibold">Drop a .csv file here or choose one</p>
        <p className="mt-2 text-sm text-muted-foreground">Maximum 10 MB and 5,000 data rows</p>
      </button>
      <input ref={inputRef} hidden type="file" accept=".csv,text/csv" onChange={(event) => { const file = event.target.files?.[0]; if (file) void choose(file) }} />
      {loading && <p className="mt-4 flex justify-center gap-2 text-sm"><Loader2 className="animate-spin" />Parsing actual file contents...</p>}
    </Card>}

    {error && <p role="alert" className="mt-4 rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}

    {preview && <div className="mt-7 space-y-6">
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <FileSpreadsheet className="text-primary" />
          <div>
            <p className="font-semibold">{preview.filename}</p>
            <p className="text-sm text-muted-foreground">Detected {preview.delimiter === ';' ? 'semicolon' : preview.delimiter === ',' ? 'comma' : JSON.stringify(preview.delimiter)} delimiter - {validated.length} rows</p>
          </div>
        </div>
      </Card>

      <Card className="p-5">
        <h2 className="text-lg font-semibold">Map columns</h2>
        <p className="mt-1 text-sm text-muted-foreground">Correct any automatic mappings before importing.</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {preview.headers.map((header) => <label key={header} className="text-sm font-medium">
            {header}
            <select value={mapping[header] ?? 'ignore'} onChange={(event) => setMapping((current) => ({ ...current, [header]: event.target.value as CsvField }))} className="mt-1.5 h-10 w-full rounded-lg border bg-background px-2">
              {fields.map((field) => <option key={field.value} value={field.value}>{field.label}</option>)}
            </select>
          </label>)}
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b p-5">
          <div>
            <h2 className="text-lg font-semibold">Row review</h2>
            <div className="mt-2 flex flex-wrap gap-2">
              <Badge tone="success">{summary.valid} valid</Badge>
              <Badge tone="warning">{summary.warning} warnings</Badge>
              <Badge tone="destructive">{summary.invalid} invalid</Badge>
              <Badge tone="primary">{summary.attempted} eligible</Badge>
              {summary.skipped > 0 && <Badge tone="outline">{summary.skipped} skipped</Badge>}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={includeWarnings} onChange={(event) => setIncludeWarnings(event.target.checked)} />Include warning rows</label>
        </div>
        {summary.skipped > 0 && <div className="border-b px-5 py-3 text-sm text-muted-foreground">
          {skippedEntries(summary.skippedByReason).map(([reason, count]) => `${IMPORT_SKIP_REASON_LABELS[reason]}: ${count}`).join(' - ')}
        </div>}
        <div className="max-h-[32rem] overflow-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="sticky top-0 bg-muted"><tr><th className="p-3">Row</th><th className="p-3">Status</th>{preview.headers.slice(0, 5).map((header) => <th className="p-3" key={header}>{header}</th>)}<th className="p-3">Messages</th></tr></thead>
            <tbody>
              {validated.slice(0, 50).map((row) => <tr key={row.rowNumber} className="border-t">
                <td className="p-3">{row.rowNumber}</td>
                <td className="p-3">{row.status === 'valid' ? <CheckCircle2 className="size-4 text-success" /> : row.status === 'warning' ? <AlertTriangle className="size-4 text-warning" /> : <XCircle className="size-4 text-destructive" />}</td>
                {preview.headers.slice(0, 5).map((header) => <td className="max-w-52 truncate p-3" key={header}>{row.values[header]}</td>)}
                <td className="p-3 text-xs text-muted-foreground">{row.issues.map((issue) => issue.message).join('; ') || 'Ready to import'}</td>
              </tr>)}
            </tbody>
          </table>
        </div>
        {validated.length > 50 && <p className="border-t p-3 text-xs text-muted-foreground">Showing the first 50 rows. All {validated.length} rows will be validated.</p>}
      </Card>

      <div className="flex flex-wrap justify-between gap-3">
        <Button variant="outline" onClick={() => { setPreview(null); setError('') }}>Choose another file</Button>
        <Button onClick={() => void confirm()} disabled={loading || summary.attempted === 0}>{loading && <Loader2 className="animate-spin" />}{loading ? 'Importing...' : `Import ${summary.attempted} contacts`}</Button>
      </div>
    </div>}

    <Card className="mt-8 border-dashed p-5">
      <h2 className="font-semibold">Need a safe demo?</h2>
      <p className="mt-1 text-sm text-muted-foreground">Sample data is fictional and is never presented as a CSV import.</p>
      <Button variant="outline" className="mt-3" onClick={async () => { await fetch('/api/contacts/sample', { method: 'POST' }); router.push('/') }}>Load sample network</Button>
    </Card>
  </div>
}
