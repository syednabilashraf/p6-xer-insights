import { parseXer, XerFormatError } from './xer.ts'
import type { Schedule } from './schedule.ts'
import { DAY_MS, toSchedule } from './schedule.ts'
import { fmtDate } from './summary.ts'
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

export type Grouped = { kept: Loaded[]; dropped: { name: string; reason: string }[] }

const MIN_SHARED_IDS = 0.5
const MIN_SAME_NAMES = 0.7
const MIN_SAME_ACTUALS = 0.7
const MIN_ACTUALS_TO_COMPARE = 3

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
const sameDay = (a: number, b: number) => Math.floor(a / DAY_MS) === Math.floor(b / DAY_MS)
const pct = (n: number) => Math.round(n * 100)

function projectMismatch(file: Loaded, latest: Loaded): string | null {
  const theirs = new Map(latest.schedule.activities.map((a) => [a.code, a]))
  const own = file.schedule.activities
  const shared = own.filter((a) => theirs.has(a.code))
  const sharedShare = own.length ? shared.length / own.length : 0
  if (sharedShare < MIN_SHARED_IDS) {
    return `Only ${pct(sharedShare)}% of its activity IDs appear in ${latest.name}, so it looks like a different project and wasn't compared`
  }
  const renamed = shared.filter((a) => norm(a.name) !== norm(theirs.get(a.code)!.name))
  const nameShare = 1 - renamed.length / shared.length
  if (nameShare < MIN_SAME_NAMES) {
    const x = renamed[0]
    return `Its activity IDs match ${latest.name}, but ${nameShare === 0 ? 'none' : `only ${pct(nameShare)}%`} of those activities have the same name (${x.code} is "${x.name}" here and "${theirs.get(x.code)!.name}" there). It looks like a different project that uses the same ID numbering, so it wasn't compared`
  }
  const started = shared.filter((a) => a.actualStart !== null)
  if (started.length >= MIN_ACTUALS_TO_COMPARE) {
    const moved = started.filter((a) => {
      const later = theirs.get(a.code)!.actualStart
      return later === null || !sameDay(a.actualStart!, later)
    })
    if (1 - moved.length / started.length < MIN_SAME_ACTUALS) {
      const x = moved[0]
      const later = theirs.get(x.code)!.actualStart
      return `Its activities match ${latest.name}, but ${moved.length === started.length ? `all ${started.length}` : `${moved.length} of the ${started.length}`} actual start dates it records are different there (${x.code} started ${fmtDate(x.actualStart!)} here and ${later === null ? 'has no actual start' : fmtDate(later)} there). Work that already happened shouldn't change between updates, so it looks like a different project built from the same template and wasn't compared`
    }
  }
  return null
}

export function sameProjectOnly(files: Loaded[]): Grouped {
  if (files.length < 2) return { kept: files, dropped: [] }
  const latest = [...files].sort((a, b) => b.schedule.dataDate - a.schedule.dataDate)[0]
  const kept: Loaded[] = []
  const dropped: { name: string; reason: string }[] = []
  for (const f of files) {
    if (f === latest) {
      kept.push(f)
      continue
    }
    const reason = projectMismatch(f, latest)
    if (reason) {
      dropped.push({ name: f.name, reason })
      continue
    }
    const ownId = f.schedule.projectName
    const theirId = latest.schedule.projectName
    if (ownId === theirId) {
      kept.push(f)
      continue
    }
    kept.push({
      ...f,
      warnings: [
        `Its project ID (${ownId}) differs from ${latest.name} (${theirId}), but its activities, names and actual dates match, so it was compared as an earlier update. Updates saved as copies often get a new project ID.`,
        ...f.warnings,
      ],
    })
  }
  return { kept, dropped }
}
