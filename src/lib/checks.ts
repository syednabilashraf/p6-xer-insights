import type { Activity, Schedule } from './schedule.ts'
import { HOURS_PER_DAY } from './schedule.ts'

export type CheckStatus = 'pass' | 'warn' | 'fail'

export type CheckResult = {
  key: string
  label: string
  detail: string
  count: number
  total: number
  status: CheckStatus
  examples: string[]
}

const HARD_CONSTRAINTS = new Set(['CS_MSO', 'CS_MFO', 'CS_MANDSTART', 'CS_MANDFIN'])
const LONG_HOURS = 44 * HOURS_PER_DAY

function pctStatus(count: number, total: number, limitPct: number): CheckStatus {
  if (count === 0) return 'pass'
  return total > 0 && (count / total) * 100 <= limitPct ? 'warn' : 'fail'
}

function codes(list: Activity[]): string[] {
  return list.slice(0, 5).map((a) => `${a.code} ${a.name}`)
}

export function runChecks(s: Schedule): CheckResult[] {
  const work = s.activities.filter((a) => a.type !== 'wbs' && a.type !== 'loe')
  const open = work.filter((a) => a.status !== 'complete')
  const hasPred = new Set(s.relationships.map((r) => r.succ))
  const hasSucc = new Set(s.relationships.map((r) => r.pred))

  const noPred = open.filter((a) => a.type !== 'start' && !hasPred.has(a.id))
  const noSucc = open.filter((a) => a.type !== 'finish' && !hasSucc.has(a.id))
  const missingLogic = [...new Map([...noPred, ...noSucc].map((a) => [a.id, a])).values()]
  const leads = s.relationships.filter((r) => r.lagHours < 0)
  const lags = s.relationships.filter((r) => r.lagHours > 0)
  const nonFs = s.relationships.filter((r) => r.type !== 'FS')
  const hard = open.filter((a) => HARD_CONSTRAINTS.has(a.constraint))
  const negFloat = open.filter((a) => (a.totalFloatHours ?? 0) < 0)
  const highFloat = open.filter((a) => (a.totalFloatHours ?? 0) > LONG_HOURS)
  const longDur = open.filter((a) => a.type === 'task' && a.originalHours > LONG_HOURS)
  const badActuals = work.filter(
    (a) => (a.actualStart ?? 0) > s.dataDate || (a.actualFinish ?? 0) > s.dataDate,
  )
  const badForecast = open.filter((a) => a.earlyFinish !== null && a.earlyFinish < s.dataDate)
  const relTotal = s.relationships.length

  return [
    {
      key: 'logic',
      label: 'Missing logic',
      detail: 'Open activities with no predecessor or no successor (open ends)',
      count: missingLogic.length,
      total: open.length,
      status: pctStatus(missingLogic.length, open.length, 5),
      examples: codes(missingLogic),
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
      detail: 'Open activities behind a required date',
      count: negFloat.length,
      total: open.length,
      status: negFloat.length ? 'fail' : 'pass',
      examples: codes(negFloat),
    },
    {
      key: 'highfloat',
      label: 'High float',
      detail: 'Open activities with more than 44 working days of float',
      count: highFloat.length,
      total: open.length,
      status: pctStatus(highFloat.length, open.length, 5),
      examples: codes(highFloat),
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
