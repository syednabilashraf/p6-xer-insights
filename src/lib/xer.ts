export type XerRow = Record<string, string>

export type XerTable = {
  name: string
  fields: string[]
  rows: XerRow[]
}

export type XerFile = {
  header: string[]
  tables: Map<string, XerTable>
  warnings: string[]
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
  let current: XerTable | null = null

  for (let i = first + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === '') continue
    const tag = line.slice(0, 2)
    if (tag === '%T') {
      const name = line.slice(3).trim()
      current = { name, fields: [], rows: [] }
      tables.set(name, current)
    } else if (tag === '%F') {
      if (!current) throw new XerFormatError(`Line ${i + 1}: field list before any table.`)
      current.fields = line.slice(3).split('\t')
    } else if (tag === '%R') {
      if (!current || current.fields.length === 0) {
        throw new XerFormatError(`Line ${i + 1}: data row before the table's field list.`)
      }
      const values = line.slice(3).split('\t')
      if (values.length !== current.fields.length) {
        warnings.push(
          `${current.name} line ${i + 1}: expected ${current.fields.length} values, found ${values.length}.`,
        )
      }
      const row: XerRow = {}
      for (let f = 0; f < current.fields.length; f++) row[current.fields[f]] = values[f] ?? ''
      current.rows.push(row)
    } else if (tag === '%E') {
      break
    }
  }

  if (!tables.has('TASK')) {
    throw new XerFormatError('The file has no TASK table, so there are no activities to analyse.')
  }
  if (!tables.has('PROJECT')) {
    throw new XerFormatError('The file has no PROJECT table.')
  }
  return { header, tables, warnings }
}
