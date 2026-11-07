import type { Comparison, UpdateMetrics } from './metrics.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function fmtDate(ms: number): string {
  const d = new Date(ms)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

const activities = (n: number) => (n === 1 ? '1 activity' : `${n} activities`)

export type Summary = { text: string; facts: Record<string, string | number> }

export function buildSummary(m: UpdateMetrics, c: Comparison | null, prev: UpdateMetrics | null): Summary {
  const facts: Record<string, string | number> = {}
  const f = (key: string, v: string | number) => {
    facts[key] = v
    return String(v)
  }
  const parts: string[] = []

  const variance = m.finishVarianceDays
  const varianceText = !m.hasPlannedDates
    ? 'and the file has no planned (target) dates to compare against'
    : variance === 0
      ? 'on the planned finish date'
      : `${f('varianceDays', Math.abs(variance))} days ${variance > 0 ? 'later' : 'earlier'} than the planned finish of ${f('plannedFinish', fmtDate(m.plannedFinish))}`
  parts.push(
    `As of ${f('dataDate', fmtDate(m.dataDate))}, the project is forecast to finish on ${f('forecastFinish', fmtDate(m.forecastFinish))}, ${varianceText}.`,
  )

  if (c && prev) {
    const mv = c.finishMovementDays
    parts.push(
      mv === 0
        ? `The forecast finish did not move since the ${f('prevDataDate', fmtDate(prev.dataDate))} update.`
        : `The forecast finish moved ${f('movementDays', Math.abs(mv))} days ${mv > 0 ? 'later' : 'earlier'} since the ${f('prevDataDate', fmtDate(prev.dataDate))} update.`,
    )
  }

  parts.push(
    `Work is ${f('pctActual', m.pctActual)}% complete against ${f('pctPlanned', m.pctPlanned)}% planned. ${f('critical', m.criticalCount)} open ${m.criticalCount === 1 ? 'activity is' : 'activities are'} critical and ${f('nearCritical', m.nearCriticalCount)} more ${m.nearCriticalCount === 1 ? 'is' : 'are'} within 10 working days of becoming critical.`,
  )

  if (c) {
    const top = c.floatLosers[0]
    if (top) {
      parts.push(
        `The biggest change is ${top.activity.name} (${top.activity.code}), which lost ${f('topLost', top.lostDays)} days of float and now has ${f('topFloat', top.floatDays)} left.`,
      )
    }
    if (c.joinedCritical.length) {
      facts.joinedCritical = c.joinedCritical.length
      parts.push(
        `${activities(c.joinedCritical.length)} joined the critical path this period, including ${c.joinedCritical[0].name}.`,
      )
    }
  }

  if (m.finishesPlanned > 0) {
    parts.push(
      `${f('finishesAchieved', m.finishesAchieved)} of ${f('finishesPlanned', m.finishesPlanned)} activities planned to finish ${m.periodStart ? 'this period' : 'by the data date'} did finish.`,
    )
  }

  const logic = m.checks.find((x) => x.key === 'logic')!
  const neg = m.checks.find((x) => x.key === 'negfloat')!
  const verb = (n: number, one: string, many: string) => (n === 1 ? one : many)
  parts.push(
    `Schedule quality: ${f('missingLogic', logic.count)} open ${verb(logic.count, 'activity has', 'activities have')} missing logic and ${f('negativeFloat', neg.count)} ${verb(neg.count, 'has', 'have')} negative float.`,
  )

  return { text: parts.join(' '), facts }
}

const DATE_RE = /\b\d{1,2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4}\b/g
const NUM_RE = /(?<![\w.])-?\d+(?:\.\d+)?(?![\w])/g
const ALWAYS_ALLOWED = new Set(['10'])

export type Verification = { checked: number; unknown: string[] }

export function verifySummary(text: string, facts: Record<string, string | number>): Verification {
  const allowed = new Set<string>(ALWAYS_ALLOWED)
  for (const v of Object.values(facts)) allowed.add(String(v))
  const unknown: string[] = []
  let checked = 0
  const dates = text.match(DATE_RE) ?? []
  for (const d of dates) {
    checked++
    if (!allowed.has(d)) unknown.push(d)
  }
  const rest = text.replace(DATE_RE, ' ')
  for (const n of rest.match(NUM_RE) ?? []) {
    checked++
    if (!allowed.has(n)) unknown.push(n)
  }
  return { checked, unknown }
}

export function llmPrompt(facts: Record<string, string | number>): string {
  return [
    'Write a short executive summary of this schedule update for a project controls team.',
    'Use only the numbers and dates in FACTS. Do not calculate, estimate or round any new number.',
    'If a fact you need is missing, leave it out.',
    '',
    `FACTS: ${JSON.stringify(facts)}`,
    '',
    'Every number in your answer is checked against FACTS; an answer with any other number is rejected and regenerated.',
  ].join('\n')
}
