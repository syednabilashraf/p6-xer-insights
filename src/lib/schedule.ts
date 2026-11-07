import type { XerFile, XerRow } from './xer.ts'
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

export type Schedule = {
  projectName: string
  dataDate: number
  scheduledFinish: number | null
  activities: Activity[]
  relationships: Relationship[]
  warnings: string[]
}

export const HOURS_PER_DAY = 8
export const DAY_MS = 24 * 60 * 60 * 1000

export function parseP6Date(value: string | undefined): number | null {
  if (!value) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/.exec(value.trim())
  if (!m) return null
  return Date.UTC(+m[1], +m[2] - 1, +m[3], m[4] ? +m[4] : 0, m[5] ? +m[5] : 0)
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

const REL_MAP: Record<string, RelType> = { PR_FS: 'FS', PR_SS: 'SS', PR_FF: 'FF', PR_SF: 'SF' }

function num(v: string | undefined): number {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? n : 0
}

function nullableNum(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null
  const n = parseFloat(v)
  return Number.isFinite(n) ? n : null
}

function rows(xer: XerFile, table: string): XerRow[] {
  return xer.tables.get(table)?.rows ?? []
}

export function toSchedule(xer: XerFile): Schedule {
  const warnings: string[] = []
  const project: XerRow = rows(xer, 'PROJECT')[0] ?? {}
  if (!xer.tables.has('PROJECT')) warnings.push('The file has no PROJECT table, so the data date comes from the latest actual date (or the export date).')
  const projId = project.proj_id

  const wbsNames = new Map(rows(xer, 'PROJWBS').map((w) => [w.wbs_id, w.wbs_name]))

  const unknownTypes = new Set<string>()
  const activities: Activity[] = rows(xer, 'TASK')
    .filter((t) => !projId || !t.proj_id || t.proj_id === projId)
    .map((t) => {
      if (t.task_type && !TYPE_MAP[t.task_type]) unknownTypes.add(`${t.task_code} (${t.task_type})`)
      const actualStart = parseP6Date(t.act_start_date)
      const actualFinish = parseP6Date(t.act_end_date)
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
      targetStart: parseP6Date(t.target_start_date),
      targetFinish: parseP6Date(t.target_end_date),
      earlyStart: parseP6Date(t.early_start_date),
      earlyFinish: parseP6Date(t.early_end_date),
      actualStart,
      actualFinish,
      constraint: t.cstr_type ?? '',
      }
    })
  if (unknownTypes.size) {
    warnings.push(`Unknown activity type, treated as a task: ${[...unknownTypes].slice(0, 5).join(', ')}.`)
  }

  const ids = new Set(activities.map((a) => a.id))
  const codeOf = new Map(activities.map((a) => [a.id, a.code]))
  const relationships: Relationship[] = []
  for (const r of rows(xer, 'TASKPRED')) {
    if (!ids.has(r.task_id) || !ids.has(r.pred_task_id)) {
      const missing = ids.has(r.task_id) ? r.pred_task_id : r.task_id
      const other = codeOf.get(ids.has(r.task_id) ? r.task_id : r.pred_task_id)
      warnings.push(`A relationship${other ? ` on ${other}` : ''} points to activity ${missing}, which isn't in this file; it was ignored.`)
      continue
    }
    const lag = r.lag_hr_cnt ?? ''
    if (lag.trim() !== '' && !Number.isFinite(parseFloat(lag))) {
      warnings.push(`The lag "${lag}" on ${codeOf.get(r.pred_task_id)} → ${codeOf.get(r.task_id)} isn't a number; it was read as 0.`)
    }
    relationships.push({
      pred: r.pred_task_id,
      succ: r.task_id,
      type: REL_MAP[r.pred_type] ?? 'FS',
      lagHours: num(lag),
    })
  }

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
    warnings,
  }
}
