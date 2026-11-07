import { parseXer, XerFormatError } from './xer.ts'
import type { Schedule } from './schedule.ts'
import { toSchedule } from './schedule.ts'
import { CircularLogicError, findLoop } from './cpm.ts'

export type Loaded = { name: string; schedule: Schedule; warnings: string[] }

export function loadXer(text: string, name: string): Loaded {
  const xer = parseXer(text)
  const schedule = toSchedule(xer)
  if (schedule.activities.length === 0) throw new XerFormatError('The TASK table has no activities.')
  const loop = findLoop(
    schedule.activities.map((a) => a.id),
    schedule.relationships,
  )
  if (loop) {
    const code = new Map(schedule.activities.map((a) => [a.id, a.code]))
    throw new CircularLogicError(loop.map((id) => code.get(id) ?? id))
  }
  return { name, schedule, warnings: [...xer.warnings, ...schedule.warnings] }
}

export type Grouped = { kept: Loaded[]; dropped: { name: string; matchPct: number }[] }

export function sameProjectOnly(files: Loaded[]): Grouped {
  if (files.length < 2) return { kept: files, dropped: [] }
  const latest = [...files].sort((a, b) => b.schedule.dataDate - a.schedule.dataDate)[0]
  const codes = new Set(latest.schedule.activities.map((a) => a.code))
  const kept: Loaded[] = []
  const dropped: { name: string; matchPct: number }[] = []
  for (const f of files) {
    if (f === latest) {
      kept.push(f)
      continue
    }
    const own = f.schedule.activities.map((a) => a.code)
    const match = own.length ? own.filter((c) => codes.has(c)).length / own.length : 0
    if (match >= 0.5) kept.push(f)
    else dropped.push({ name: f.name, matchPct: Math.round(match * 100) })
  }
  return { kept, dropped }
}
