import type { Activity, Schedule } from './schedule.ts'
import { HOURS_PER_DAY } from './schedule.ts'
import type { ScheduleFloat } from './cpm.ts'
import { scheduleFloat } from './cpm.ts'

export type CheckStatus = 'pass' | 'warn' | 'fail'

export type CheckResult = {
  key: string
  label: string
  detail: string
  count: number
  total: number
  status: CheckStatus
  examples: string[]
  extra?: { count: number; label: string; examples: string[] }
}

const HARD_CONSTRAINTS = new Set(['CS_MSO', 'CS_MFO', 'CS_MANDSTART', 'CS_MANDFIN'])
export const HIGH_FLOAT_DAYS = 44
const LONG_HOURS = HIGH_FLOAT_DAYS * HOURS_PER_DAY

function pctStatus(count: number, total: number, limitPct: number): CheckStatus {
  if (count === 0) return 'pass'
  return total > 0 && (count / total) * 100 <= limitPct ? 'warn' : 'fail'
}

function codes(list: Activity[], note?: (a: Activity) => string): string[] {
  return list.slice(0, 5).map((a) => `${a.code} ${a.name}${note ? ` (${note(a)})` : ''}`)
}

function topBy(list: Activity[], score: (a: Activity) => number, k = 5): Activity[] {
  const top: { a: Activity; s: number }[] = []
  for (const a of list) {
    const v = score(a)
    if (top.length === k && v <= top[k - 1].s) continue
    top.push({ a, s: v })
    top.sort((x, y) => y.s - x.s)
    if (top.length > k) top.pop()
  }
  return top.map((x) => x.a)
}

const floatDays = (hours: number) => Math.round((hours / HOURS_PER_DAY) * 10) / 10

export function runChecks(s: Schedule, fl: ScheduleFloat = scheduleFloat(s)): CheckResult[] {
  const work = s.activities.filter((a) => a.type !== 'wbs' && a.type !== 'loe')
  const open = work.filter((a) => a.status !== 'complete')
  const hasPred = new Set(s.relationships.map((r) => r.succ))
  const hasSucc = new Set(s.relationships.map((r) => r.pred))
  const floatOf = (a: Activity) => fl.float.get(a.id) ?? 0
  const floatNote = (a: Activity) => `${floatDays(floatOf(a))} days float`

  const noPred = open.filter((a) => a.type !== 'start' && !hasPred.has(a.id))
  const noSucc = open.filter((a) => a.type !== 'finish' && !hasSucc.has(a.id))
  const missingLogic = [...new Map([...noPred, ...noSucc].map((a) => [a.id, a])).values()]
  const noPredIds = new Set(noPred.map((a) => a.id))
  const noSuccIds = new Set(noSucc.map((a) => a.id))
  const missingNote = (a: Activity) =>
    noPredIds.has(a.id) && noSuccIds.has(a.id) ? 'no links' : noPredIds.has(a.id) ? 'no predecessor' : 'no successor'
  const dangling = s.danglingLinks
  const codeOf = new Map(dangling.length ? s.activities.map((a) => [a.id, a.code]) : [])
  const label = (id: string) => codeOf.get(id) ?? (id ? `missing activity ${id}` : 'blank ID')
  const leads = s.relationships.filter((r) => r.lagHours < 0)
  const lags = s.relationships.filter((r) => r.lagHours > 0)
  const nonFs = s.relationships.filter((r) => r.type !== 'FS')
  const hard = open.filter((a) => HARD_CONSTRAINTS.has(a.constraint))
  const negFloat = open.filter((a) => floatOf(a) < 0)
  const highFloat = open.filter((a) => floatOf(a) > LONG_HOURS)
  const source = fl.source === 'P6' ? 'P6 stored total float' : 'float computed by the built-in CPM'
  const longDur = open.filter((a) => a.type === 'task' && a.originalHours > LONG_HOURS)
  const badActuals = work.filter(
    (a) => (a.actualStart ?? 0) > s.dataDate || (a.actualFinish ?? 0) > s.dataDate,
  )
  const badForecast = open.filter((a) => a.earlyFinish !== null && a.earlyFinish < s.dataDate)
  const relTotal = s.relationships.length

  return [
    {
      key: 'logic',
      label: 'Missing links',
      detail: 'Open activities with no predecessor or no successor (open ends)',
      count: missingLogic.length,
      total: open.length,
      status: dangling.length ? 'fail' : pctStatus(missingLogic.length, open.length, 5),
      examples: codes(missingLogic, missingNote),
      extra: {
        count: dangling.length,
        label: dangling.length === 1 ? "link points to an activity that isn't in the file" : "links point to activities that aren't in the file",
        examples: dangling.slice(0, 5).map((d) => `line ${d.line}: ${label(d.pred)} → ${label(d.succ)}`),
      },
    },
    {
      key: 'leads',
      label: 'Leads',
      detail: 'Relationships with negative lag',
      count: leads.length,
      total: relTotal,
      status: leads.length ? 'fail' : 'pass',
      examples: [],
    },
    {
      key: 'lags',
      label: 'Lags',
      detail: 'Relationships with positive lag',
      count: lags.length,
      total: relTotal,
      status: pctStatus(lags.length, relTotal, 5),
      examples: [],
    },
    {
      key: 'reltypes',
      label: 'Relationship types',
      detail: 'Relationships that are not finish-to-start',
      count: nonFs.length,
      total: relTotal,
      status: pctStatus(nonFs.length, relTotal, 10),
      examples: [],
    },
    {
      key: 'constraints',
      label: 'Hard constraints',
      detail: 'Mandatory or "on" date constraints that override logic',
      count: hard.length,
      total: open.length,
      status: pctStatus(hard.length, open.length, 5),
      examples: codes(hard),
    },
    {
      key: 'negfloat',
      label: 'Negative float',
      detail: `Open activities behind a required date (${source})`,
      count: negFloat.length,
      total: open.length,
      status: negFloat.length ? 'fail' : 'pass',
      examples: codes(topBy(negFloat, (a) => -floatOf(a)), floatNote),
    },
    {
      key: 'highfloat',
      label: 'High float',
      detail: `Open activities with more than ${HIGH_FLOAT_DAYS} working days of float (${source})`,
      count: highFloat.length,
      total: open.length,
      status: pctStatus(highFloat.length, open.length, 5),
      examples: codes(topBy(highFloat, floatOf), floatNote),
    },
    {
      key: 'duration',
      label: 'Long durations',
      detail: 'Activities longer than 44 working days',
      count: longDur.length,
      total: open.length,
      status: pctStatus(longDur.length, open.length, 5),
      examples: codes(longDur),
    },
    {
      key: 'dates',
      label: 'Invalid dates',
      detail: 'Actual dates after the data date, or forecast dates before it',
      count: badActuals.length + badForecast.length,
      total: work.length,
      status: badActuals.length + badForecast.length ? 'fail' : 'pass',
      examples: codes([...badActuals, ...badForecast]),
    },
  ]
}

export type FloatBucket = { key: string; label: string; count: number }

export function floatBuckets(fl: ScheduleFloat): FloatBucket[] {
  const buckets: FloatBucket[] = [
    { key: 'negative', label: '< 0', count: 0 },
    { key: 'zero', label: '0', count: 0 },
    { key: 'low', label: '1–10', count: 0 },
    { key: 'mid', label: `11–${HIGH_FLOAT_DAYS}`, count: 0 },
    { key: 'high', label: `> ${HIGH_FLOAT_DAYS}`, count: 0 },
  ]
  for (const hours of fl.float.values()) {
    const d = hours / HOURS_PER_DAY
    const i = d < 0 ? 0 : d === 0 ? 1 : d <= 10 ? 2 : d <= HIGH_FLOAT_DAYS ? 3 : 4
    buckets[i].count++
  }
  return buckets
}
