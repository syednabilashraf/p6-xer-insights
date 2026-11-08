import type { BrokenRow, XerFile, XerRow } from './xer.ts'
import { XerFormatError } from './xer.ts'

export type ActivityType = 'task' | 'start' | 'finish' | 'loe' | 'wbs'
export type ActivityStatus = 'not_started' | 'in_progress' | 'complete'
export type RelType = 'FS' | 'SS' | 'FF' | 'SF'

export type Activity = {
  id: string
  code: string
  name: string
  wbs: string
  type: ActivityType
  status: ActivityStatus
  originalHours: number
  remainingHours: number
  pctComplete: number
  totalFloatHours: number | null
  targetStart: number | null
  targetFinish: number | null
  earlyStart: number | null
  earlyFinish: number | null
  actualStart: number | null
  actualFinish: number | null
  constraint: string
}

export type Relationship = {
  pred: string
  succ: string
  type: RelType
  lagHours: number
}

export type DanglingLink = { line: number; pred: string; succ: string; missing: string[] }

export type Schedule = {
  projectName: string
  dataDate: number
  scheduledFinish: number | null
  activities: Activity[]
  relationships: Relationship[]
  warnings: string[]
  fileWarnings: string[]
  broken: BrokenRow[]
  danglingLinks: DanglingLink[]
}

export const HOURS_PER_DAY = 8
export const DAY_MS = 24 * 60 * 60 * 1000

export function parseP6Date(value: string | undefined): number | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(value.trim())
  if (!m) return null
  const y = +m[1]
  const mo = +m[2]
  const d = +m[3]
  const h = m[4] ? +m[4] : 0
  const mi = m[5] ? +m[5] : 0
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
  const monthDays = mo === 2 ? (leap ? 29 : 28) : mo === 4 || mo === 6 || mo === 9 || mo === 11 ? 30 : 31
  if (mo < 1 || mo > 12 || d < 1 || d > monthDays || h > 23 || mi > 59) return null
  return Date.UTC(y, mo - 1, d, h, mi)
}

export function formatP6Date(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

const TYPE_MAP: Record<string, ActivityType> = {
  TT_Task: 'task',
  TT_Rsrc: 'task',
  TT_Mile: 'start',
  TT_StartMile: 'start',
  TT_FinMile: 'finish',
  TT_LOE: 'loe',
  TT_WBS: 'wbs',
}

const STATUS_MAP: Record<string, ActivityStatus> = {
  TK_NotStart: 'not_started',
  TK_Active: 'in_progress',
  TK_Complete: 'complete',
}

const REL_MAP: Record<string, RelType> = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF', FS: 'FS', SS: 'SS', FF: 'FF', SF: 'SF' }

const isBlank = (v: string | undefined) => v === undefined || v.trim() === ''
const isNumber = (v: string) => Number.isFinite(Number(v.trim()))

function num(v: string | undefined): number {
  return isBlank(v) || !isNumber(v!) ? 0 : Number(v!.trim())
}

function nullableNum(v: string | undefined): number | null {
  return isBlank(v) || !isNumber(v!) ? null : Number(v!.trim())
}

function rows(xer: XerFile, table: string): XerRow[] {
  return xer.tables.get(table)?.rows ?? []
}

function lines(xer: XerFile, table: string): number[] {
  return xer.tables.get(table)?.lines ?? []
}

const DATE_FIELD = /_date2?$/
const HOURS_FIELD = /_hr_cnt$/

function cachedDates(): (value: string | undefined) => number | null {
  const cache = new Map<string, number | null>()
  return (value) => {
    if (!value) return null
    let t = cache.get(value)
    if (t === undefined) {
      t = parseP6Date(value)
      cache.set(value, t)
    }
    return t
  }
}

function valueChecker(xer: XerFile, table: string, date: (v: string) => number | null, fallback: (field: string) => string) {
  const fields = xer.tables.get(table)?.fields ?? []
  const dates = fields.filter((f) => DATE_FIELD.test(f))
  const hours = fields.filter((f) => HOURS_FIELD.test(f))
  return (row: XerRow): string[] => {
    const out: string[] = []
    for (const f of dates) {
      const v = row[f]
      if (v && !isBlank(v) && date(v) === null) out.push(`${f} "${v}" isn't a date (read as blank)`)
    }
    for (const f of hours) {
      const v = row[f]
      if (v && !isBlank(v) && !isNumber(v)) out.push(`${f} "${v}" isn't a number (read as ${fallback(f)})`)
    }
    return out
  }
}

function mergeBroken(list: BrokenRow[]): BrokenRow[] {
  const out: BrokenRow[] = []
  for (const b of [...list].sort((x, y) => x.line - y.line)) {
    const last = out[out.length - 1]
    if (last && last.line === b.line) last.reason += `; ${b.reason}`
    else out.push({ ...b })
  }
  return out
}

export function toSchedule(xer: XerFile): Schedule {
  const fileWarnings: string[] = []
  const rowWarnings: string[] = []
  const broken: BrokenRow[] = []
  const project: XerRow = rows(xer, 'PROJECT')[0] ?? {}
  if (!xer.tables.has('PROJECT')) fileWarnings.push('The file has no PROJECT table, so the data date comes from the latest actual date (or the export date).')
  const projId = project.proj_id

  const date = cachedDates()
  const projectValues = valueChecker(xer, 'PROJECT', date, () => 'blank')
  rows(xer, 'PROJECT').forEach((p, k) => {
    const issues = projectValues(p)
    if (issues.length) broken.push({ line: lines(xer, 'PROJECT')[k], table: 'PROJECT', reason: issues.join('; ') })
  })

  const wbsNames = new Map(rows(xer, 'PROJWBS').map((w) => [w.wbs_id, w.wbs_name]))

  const taskLines = lines(xer, 'TASK')
  const idLine = new Map<string, number>()
  const codeLine = new Map<string, number>()
  const usable: XerRow[] = []
  const taskValues = valueChecker(xer, 'TASK', date, (f) => (f === 'total_float_hr_cnt' || f === 'free_float_hr_cnt' ? 'blank' : '0'))
  rows(xer, 'TASK').forEach((t, k) => {
    const line = taskLines[k]
    const issues: string[] = []
    const id = (t.task_id ?? '').trim()
    const code = (t.task_code ?? '').trim()
    let skip = false
    if (!id) {
      issues.push('blank task_id; row skipped')
      skip = true
    } else if (idLine.has(id)) {
      issues.push(`duplicate task_id ${id} (first on line ${idLine.get(id)}); row skipped`)
      skip = true
    } else idLine.set(id, line)
    if (!code) issues.push('blank task_code')
    else if (!skip) {
      const key = `${t.proj_id ?? ''}\u0000${code}`
      if (codeLine.has(key)) issues.push(`duplicate task_code ${code} (also on line ${codeLine.get(key)})`)
      else codeLine.set(key, line)
    }
    issues.push(...taskValues(t))
    if (issues.length) broken.push({ line, table: 'TASK', reason: issues.join('; ') })
    if (!skip) usable.push(t)
  })

  const unknownTypes = new Set<string>()
  const activities: Activity[] = usable
    .filter((t) => !projId || !t.proj_id || t.proj_id === projId)
    .map((t) => {
      if (t.task_type && !TYPE_MAP[t.task_type]) unknownTypes.add(`${t.task_code} (${t.task_type})`)
      const actualStart = date(t.act_start_date)
      const actualFinish = date(t.act_end_date)
      const status: ActivityStatus =
        STATUS_MAP[t.status_code] ?? (actualFinish ? 'complete' : actualStart ? 'in_progress' : 'not_started')
      const originalHours = num(t.target_drtn_hr_cnt)
      const remainingHours = num(t.remain_drtn_hr_cnt)
      const pctField = nullableNum(t.phys_complete_pct)
      const pctComplete =
        pctField ?? (status === 'complete' ? 100 : status === 'in_progress' && originalHours > 0 ? Math.max(0, Math.min(100, ((originalHours - remainingHours) / originalHours) * 100)) : 0)
      return {
      id: t.task_id,
      code: t.task_code,
      name: t.task_name,
      wbs: wbsNames.get(t.wbs_id) ?? '',
      type: TYPE_MAP[t.task_type] ?? 'task',
      status,
      originalHours,
      remainingHours,
      pctComplete,
      totalFloatHours: nullableNum(t.total_float_hr_cnt),
      targetStart: date(t.target_start_date),
      targetFinish: date(t.target_end_date),
      earlyStart: date(t.early_start_date),
      earlyFinish: date(t.early_end_date),
      actualStart,
      actualFinish,
      constraint: t.cstr_type ?? '',
      }
    })
  if (unknownTypes.size) {
    fileWarnings.push(`Unknown activity type, treated as a task: ${[...unknownTypes].slice(0, 5).join(', ')}.`)
  }

  const ids = new Set(activities.map((a) => a.id))
  const inFile = new Set(idLine.keys())
  const codeOf = new Map(activities.map((a) => [a.id, a.code]))
  const relationships: Relationship[] = []
  const danglingLinks: DanglingLink[] = []
  const predLines = lines(xer, 'TASKPRED')
  const predValues = valueChecker(xer, 'TASKPRED', date, () => '0')
  rows(xer, 'TASKPRED').forEach((r, k) => {
    const line = predLines[k]
    const issues = predValues(r)
    const relType = Object.hasOwn(REL_MAP, r.pred_type) ? REL_MAP[r.pred_type] : null
    if (!relType) {
      issues.push(isBlank(r.pred_type) ? 'blank pred_type (read as FS)' : `unknown pred_type "${r.pred_type}" (read as FS)`)
    }
    const missing: string[] = []
    for (const field of ['pred_task_id', 'task_id']) {
      const v = (r[field] ?? '').trim()
      if (inFile.has(v)) continue
      missing.push(v)
      issues.push(v ? `${field} ${v} isn't an activity in this file` : `blank ${field}`)
    }
    if (issues.length) broken.push({ line, table: 'TASKPRED', reason: issues.join('; ') })

    if (missing.length) {
      danglingLinks.push({ line, pred: r.pred_task_id, succ: r.task_id, missing })
      const other = codeOf.get(ids.has(r.task_id) ? r.task_id : r.pred_task_id)
      rowWarnings.push(`A relationship${other ? ` on ${other}` : ''} points to activity ${missing[0] || '(blank)'}, which isn't in this file; it was ignored.`)
      return
    }
    if (!ids.has(r.task_id) && !ids.has(r.pred_task_id)) return
    if (!ids.has(r.task_id) || !ids.has(r.pred_task_id)) {
      const own = ids.has(r.task_id) ? r.task_id : r.pred_task_id
      const other = own === r.task_id ? r.pred_task_id : r.task_id
      rowWarnings.push(`A relationship on ${codeOf.get(own)} links to activity ${other} in another project in this file; it was ignored.`)
      return
    }
    const lag = r.lag_hr_cnt ?? ''
    if (!isBlank(lag) && !isNumber(lag)) {
      rowWarnings.push(`The lag "${lag}" on ${codeOf.get(r.pred_task_id)} → ${codeOf.get(r.task_id)} isn't a number; it was read as 0.`)
    }
    relationships.push({
      pred: r.pred_task_id,
      succ: r.task_id,
      type: relType ?? 'FS',
      lagHours: num(lag),
    })
  })

  const actuals = activities.flatMap((a) => [a.actualStart ?? 0, a.actualFinish ?? 0])
  const exportDate = parseP6Date(xer.header[2])
  const dataDate =
    parseP6Date(project.last_recalc_date) ??
    (actuals.some((t) => t > 0) ? Math.max(...actuals) : null) ??
    exportDate ??
    parseP6Date(project.plan_start_date)
  if (dataDate === null) throw new XerFormatError('The file has no data date (PROJECT last_recalc_date) and no actual dates.')

  return {
    projectName: project.proj_short_name || 'Project',
    dataDate,
    scheduledFinish: parseP6Date(project.scd_end_date),
    activities,
    relationships,
    warnings: [...fileWarnings, ...rowWarnings],
    fileWarnings,
    broken: mergeBroken([...xer.broken, ...broken]),
    danglingLinks,
  }
}
