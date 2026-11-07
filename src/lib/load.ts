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
  return { name, schedule, warnings: xer.warnings }
}
