import type { Activity, Schedule } from './schedule.ts'
import { DAY_MS, HOURS_PER_DAY } from './schedule.ts'
import type { CheckResult } from './checks.ts'
import { runChecks } from './checks.ts'
import { runCpm } from './cpm.ts'

export const NEAR_CRITICAL_HOURS = 10 * HOURS_PER_DAY

export type UpdateMetrics = {
  projectName: string
  dataDate: number
  activityCount: number
  complete: number
  inProgress: number
  notStarted: number
  plannedFinish: number
  hasPlannedDates: boolean
  forecastFinish: number
  finishVarianceDays: number
  criticalCount: number
  nearCriticalCount: number
  negativeFloatCount: number
  avgFloatDays: number
  pctActual: number
  pctPlanned: number
  finishesPlanned: number
  finishesAchieved: number
  startsPlanned: number
  startsAchieved: number
  periodStart: number | null
  floatSource: 'P6' | 'computed'
  float: Map<string, number>
  critical: Activity[]
  checks: CheckResult[]
}

export type Comparison = {
  finishMovementDays: number
  joinedCritical: Activity[]
  leftCritical: Activity[]
  floatLosers: { activity: Activity; lostDays: number; floatDays: number }[]
  slipped: { activity: Activity; slipDays: number }[]
}

export type Analysis = {
  schedules: Schedule[]
  metrics: UpdateMetrics[]
  comparisons: (Comparison | null)[]
  sCurve: { planned: { t: number; pct: number }[]; actual: { t: number; pct: number }[] }
  ms: number
}

const days = (hours: number) => hours / HOURS_PER_DAY
const round1 = (n: number) => Math.round(n * 10) / 10
const isWork = (a: Activity) => a.type !== 'wbs' && a.type !== 'loe'

function weight(a: Activity): number {
  return a.type === 'task' ? Math.max(a.originalHours, HOURS_PER_DAY) : 0
}

export function plannedPctAt(acts: Activity[], t: number): number {
  let w = 0
  let done = 0
  for (const a of acts) {
    const aw = weight(a)
    if (!aw || a.targetStart === null || a.targetFinish === null) continue
    w += aw
    const span = a.targetFinish - a.targetStart
    const frac = span <= 0 ? (t >= a.targetFinish ? 1 : 0) : (t - a.targetStart) / span
    done += aw * Math.min(1, Math.max(0, frac))
  }
  return w ? (done / w) * 100 : 0
}

export function actualPct(acts: Activity[]): number {
  let w = 0
  let done = 0
  for (const a of acts) {
    const aw = weight(a)
    if (!aw) continue
    w += aw
    done += aw * (a.status === 'complete' ? 1 : a.pctComplete / 100)
  }
  return w ? (done / w) * 100 : 0
}

export function computeMetrics(s: Schedule, prev: Schedule | null): UpdateMetrics {
  const acts = s.activities.filter(isWork)
  const open = acts.filter((a) => a.status !== 'complete')

  const p6Float = open.filter((a) => a.totalFloatHours !== null).length
  const useP6 = open.length > 0 && p6Float / open.length >= 0.9
  const float = new Map<string, number>()
  let cpmFinish: number | null = null
  if (useP6) {
    for (const a of open) float.set(a.id, a.totalFloatHours ?? 0)
  } else {
    const cpm = runCpm(acts, s.relationships)
    for (const a of open) float.set(a.id, cpm.times.get(a.id)!.tf)
    cpmFinish = s.dataDate + (cpm.finishHours / HOURS_PER_DAY) * DAY_MS
  }

  const critical = open
    .filter((a) => (float.get(a.id) ?? 0) <= 0)
    .sort((a, b) => (a.earlyStart ?? 0) - (b.earlyStart ?? 0))
  const nearCritical = open.filter((a) => {
    const f = float.get(a.id) ?? 0
    return f > 0 && f <= NEAR_CRITICAL_HOURS
  })
  const negative = open.filter((a) => (float.get(a.id) ?? 0) < 0)

  const finishes = acts.map((a) => a.actualFinish ?? a.earlyFinish ?? a.targetFinish ?? 0)
  const forecastFinish = cpmFinish ?? s.scheduledFinish ?? finishes.reduce((x, y) => Math.max(x, y), 0)
  const targets = acts.map((a) => a.targetFinish).filter((t): t is number => t !== null)
  const hasPlannedDates = targets.length > 0
  const plannedFinish = hasPlannedDates ? targets.reduce((x, y) => Math.max(x, y), 0) : forecastFinish

  const periodStart = prev ? prev.dataDate : null
  const inPeriod = (t: number | null) =>
    t !== null && t <= s.dataDate && (periodStart === null || t > periodStart)
  const finishesDue = acts.filter((a) => inPeriod(a.targetFinish))
  const startsDue = acts.filter((a) => inPeriod(a.targetStart))

  const floats = open.map((a) => float.get(a.id) ?? 0)
  return {
    projectName: s.projectName,
    dataDate: s.dataDate,
    activityCount: acts.length,
    complete: acts.length - open.length,
    inProgress: open.filter((a) => a.status === 'in_progress').length,
    notStarted: open.filter((a) => a.status === 'not_started').length,
    plannedFinish,
    hasPlannedDates,
    forecastFinish,
    finishVarianceDays: Math.round((forecastFinish - plannedFinish) / DAY_MS),
    criticalCount: critical.length,
    nearCriticalCount: nearCritical.length,
    negativeFloatCount: negative.length,
    avgFloatDays: floats.length ? round1(days(floats.reduce((x, y) => x + y, 0) / floats.length)) : 0,
    pctActual: round1(actualPct(acts)),
    pctPlanned: round1(plannedPctAt(acts, s.dataDate)),
    finishesPlanned: finishesDue.length,
    finishesAchieved: finishesDue.filter((a) => a.actualFinish !== null).length,
    startsPlanned: startsDue.length,
    startsAchieved: startsDue.filter((a) => a.actualStart !== null).length,
    periodStart,
    floatSource: useP6 ? 'P6' : 'computed',
    float,
    critical,
    checks: runChecks(s),
  }
}

export function compare(prev: UpdateMetrics, curr: UpdateMetrics, prevS: Schedule, currS: Schedule): Comparison {
  const prevCrit = new Set(prev.critical.map((a) => a.id))
  const currCrit = new Set(curr.critical.map((a) => a.id))
  const prevById = new Map(prevS.activities.map((a) => [a.id, a]))

  const floatLosers = currS.activities
    .filter((a) => curr.float.has(a.id) && prev.float.has(a.id))
    .map((a) => ({
      activity: a,
      lostDays: Math.round(days(prev.float.get(a.id)! - curr.float.get(a.id)!)),
      floatDays: Math.round(days(curr.float.get(a.id)!)),
    }))
    .filter((x) => x.lostDays >= 5)
    .sort((x, y) => y.lostDays - x.lostDays)
    .slice(0, 5)

  const slipped = currS.activities
    .filter((a) => a.status !== 'complete' && a.earlyFinish !== null)
    .map((a) => {
      const before = prevById.get(a.id)?.earlyFinish ?? null
      return { activity: a, slipDays: before === null ? 0 : Math.round((a.earlyFinish! - before) / DAY_MS) }
    })
    .filter((x) => x.slipDays >= 5)
    .sort((x, y) => y.slipDays - x.slipDays)
    .slice(0, 5)

  return {
    finishMovementDays: Math.round((curr.forecastFinish - prev.forecastFinish) / DAY_MS),
    joinedCritical: curr.critical.filter((a) => !prevCrit.has(a.id)),
    leftCritical: prev.critical.filter((a) => !currCrit.has(a.id) && a.status !== 'complete'),
    floatLosers,
    slipped,
  }
}

export function analyse(schedules: Schedule[]): Analysis {
  const t0 = performance.now()
  const sorted = [...schedules].sort((a, b) => a.dataDate - b.dataDate)
  const metrics = sorted.map((s, i) => computeMetrics(s, i ? sorted[i - 1] : null))
  const comparisons = metrics.map((m, i) => (i ? compare(metrics[i - 1], m, sorted[i - 1], sorted[i]) : null))

  const latest = sorted[sorted.length - 1].activities.filter(isWork)
  const starts = latest.map((a) => a.targetStart).filter((t): t is number => t !== null)
  const ends = latest.map((a) => a.targetFinish).filter((t): t is number => t !== null)
  const planned: { t: number; pct: number }[] = []
  if (starts.length && ends.length) {
    const from = Math.min(...starts)
    const to = Math.max(...ends)
    const steps = 48
    for (let i = 0; i <= steps; i++) {
      const t = from + ((to - from) * i) / steps
      planned.push({ t, pct: round1(plannedPctAt(latest, t)) })
    }
  }
  const actual = metrics.map((m) => ({ t: m.dataDate, pct: m.pctActual }))
  return { schedules: sorted, metrics, comparisons, sCurve: { planned, actual }, ms: performance.now() - t0 }
}
