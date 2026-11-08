export type XerRow = Record<string, string>

export type XerTable = {
  name: string
  fields: string[]
  rows: XerRow[]
  lines: number[]
}

export type BrokenRow = { line: number; table: string; reason: string }

export type XerFile = {
  header: string[]
  tables: Map<string, XerTable>
  warnings: string[]
  broken: BrokenRow[]
}

export class XerFormatError extends Error {}

export function decodeXer(bytes: ArrayBuffer): string {
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
  if (!utf8.includes('�')) return utf8
  return new TextDecoder('windows-1252').decode(bytes)
}

export function parseXer(text: string): XerFile {
  const lines = text.split(/\r?\n/)
  const first = lines.findIndex((l) => l.trim() !== '')
  if (first === -1) throw new XerFormatError('The file is empty.')
  if (!lines[first].startsWith('ERMHDR')) {
    throw new XerFormatError(
      "This doesn't look like a Primavera P6 .xer export: the first line should start with ERMHDR.",
    )
  }

  const header = lines[first].split('\t')
  const tables = new Map<string, XerTable>()
  const warnings: string[] = []
  const broken: BrokenRow[] = []
  let current: XerTable | null = null
  let required = 0

  for (let i = first + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line.trim() === '') continue
    const tag = line.slice(0, 2)
    if (tag === '%T') {
      const name = line.slice(3).trim()
      current = { name, fields: [], rows: [], lines: [] }
      tables.set(name, current)
    } else if (tag === '%F') {
      if (!current) throw new XerFormatError(`Line ${i + 1}: field list before any table.`)
      current.fields = line.slice(3).split('\t')
      required = current.fields.findLastIndex((f) => f !== '') + 1
    } else if (tag === '%R') {
      if (!current || current.fields.length === 0) {
        throw new XerFormatError(`Line ${i + 1}: data row before the table's field list.`)
      }
      const values = line.slice(3).split('\t')
      const used = values.findLastIndex((v) => v !== '') + 1
      if (used > current.fields.length) {
        warnings.push(
          `${current.name} line ${i + 1}: ${used} values for ${current.fields.length} fields; the extra values were ignored.`,
        )
        broken.push({ line: i + 1, table: current.name, reason: `${used} values for ${current.fields.length} fields; the extra values were ignored` })
      } else if (values.length < required) {
        broken.push({ line: i + 1, table: current.name, reason: `short row: ${values.length} values for ${required} fields; the missing ones were read as blank` })
      }
      const row: XerRow = {}
      for (let f = 0; f < current.fields.length; f++) row[current.fields[f]] = values[f] ?? ''
      current.rows.push(row)
      current.lines.push(i + 1)
    } else if (tag === '%E') {
      current = null
    } else {
      broken.push({ line: i + 1, table: current?.name ?? '', reason: "doesn't start with %T, %F, %R or %E, so it was skipped (often a value with a line break in it)" })
    }
  }

  if (!tables.has('TASK')) {
    throw new XerFormatError('The file has no TASK table, so there are no activities to analyse.')
  }
  return { header, tables, warnings, broken }
}
