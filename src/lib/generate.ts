import { DAY_MS, HOURS_PER_DAY, formatP6Date } from './schedule.ts'

type Kind = 'start' | 'finish' | 'task'
type Pred = { code: string; type?: 'FS' | 'SS' | 'FF' | 'SF'; lagDays?: number }
type Spec = { code: string; name: string; wbs: string; days: number; kind?: Kind; preds: Pred[]; constraint?: string }

const fs = (...codes: string[]): Pred[] => codes.map((code) => ({ code }))

function midriseSpecs(): Spec[] {
  const s: Spec[] = [
    { code: 'A1000', name: 'Notice to proceed', wbs: 'Preconstruction', days: 0, kind: 'start', preds: [] },
    { code: 'A1010', name: 'Building permit issued', wbs: 'Preconstruction', days: 3, preds: fs('A1000') },
    { code: 'A1020', name: 'Mobilize site', wbs: 'Preconstruction', days: 5, preds: fs('A1010') },
    { code: 'A1100', name: 'Clear and grub', wbs: 'Sitework', days: 4, preds: fs('A1020') },
    { code: 'A1110', name: 'Excavation and shoring', wbs: 'Sitework', days: 12, preds: fs('A1100') },
    { code: 'A1120', name: 'Underground utilities', wbs: 'Sitework', days: 10, preds: [{ code: 'A1110', type: 'SS', lagDays: 5 }] },
    { code: 'A1130', name: 'Building pad and compaction', wbs: 'Sitework', days: 5, preds: fs('A1110', 'A1120') },
    { code: 'A1200', name: 'Footings', wbs: 'Foundations', days: 8, preds: fs('A1130') },
    { code: 'A1210', name: 'Foundation walls', wbs: 'Foundations', days: 10, preds: fs('A1200') },
    { code: 'A1220', name: 'Underslab plumbing and electrical', wbs: 'Foundations', days: 6, preds: fs('A1210') },
    { code: 'A1230', name: 'Slab on grade', wbs: 'Foundations', days: 5, preds: fs('A1220') },
    { code: 'A1300', name: 'Podium deck, level 1', wbs: 'Structure', days: 15, preds: fs('A1230') },
    { code: 'A1310', name: 'Frame level 2', wbs: 'Structure', days: 12, preds: fs('A1300') },
    { code: 'A1320', name: 'Frame level 3', wbs: 'Structure', days: 12, preds: fs('A1310') },
    { code: 'A1330', name: 'Frame level 4', wbs: 'Structure', days: 12, preds: fs('A1320') },
    { code: 'A1340', name: 'Frame level 5', wbs: 'Structure', days: 12, preds: fs('A1330') },
    { code: 'A1350', name: 'Roof framing', wbs: 'Structure', days: 8, preds: fs('A1340') },
    { code: 'A1360', name: 'Roofing', wbs: 'Structure', days: 10, preds: fs('A1350') },
    { code: 'A1400', name: 'Windows, levels 2-3', wbs: 'Envelope', days: 10, preds: fs('A1320') },
    { code: 'A1410', name: 'Windows, levels 4-5', wbs: 'Envelope', days: 10, preds: fs('A1340', 'A1400') },
    { code: 'A1420', name: 'Sheathing and weather barrier', wbs: 'Envelope', days: 15, preds: fs('A1410') },
    { code: 'A1430', name: 'Exterior cladding', wbs: 'Envelope', days: 25, preds: fs('A1420') },
    { code: 'A1440', name: 'Exterior building signage', wbs: 'Envelope', days: 5, preds: fs('A1430') },
    { code: 'A1500', name: 'Switchgear submittal and approval', wbs: 'Long-lead equipment', days: 15, preds: fs('A1000') },
    { code: 'A1510', name: 'Switchgear fabrication and delivery', wbs: 'Long-lead equipment', days: 70, preds: fs('A1500') },
    { code: 'A1520', name: 'Elevator submittal and approval', wbs: 'Long-lead equipment', days: 20, preds: fs('A1000') },
    { code: 'A1530', name: 'Elevator fabrication', wbs: 'Long-lead equipment', days: 90, preds: fs('A1520') },
    { code: 'A1540', name: 'Elevator installation', wbs: 'Long-lead equipment', days: 20, preds: fs('A1530', 'A1360') },
  ]
  const levels = [2, 3, 4, 5]
  const frame: Record<number, string> = { 2: 'A1320', 3: 'A1330', 4: 'A1340', 5: 'A1350' }
  levels.forEach((lv, i) => {
    const base = 1600 + i * 10
    s.push({ code: `A${base}`, name: `MEP rough-in, level ${lv}`, wbs: 'MEP rough-in', days: 15, preds: fs(frame[lv], ...(i ? [`A${base - 10}`] : ['A1400'])) })
  })
  levels.forEach((lv, i) => {
    s.push({ code: `A${1640 + i * 10}`, name: `Rough-in inspection, level ${lv}`, wbs: 'MEP rough-in', days: 2, preds: fs(`A${1600 + i * 10}`) })
  })
  s.push({ code: 'A1700', name: 'Permanent power energized', wbs: 'Long-lead equipment', days: 5, preds: fs('A1510', 'A1630') })
  const steps: [string, number][] = [
    ['Insulation and inspection', 5],
    ['Drywall hang and finish', 15],
    ['Paint', 8],
    ['Cabinets and countertops', 10],
    ['Flooring', 8],
    ['MEP trim and fixtures', 8],
  ]
  levels.forEach((lv, i) => {
    const base = 1800 + i * 100
    steps.forEach(([name, days], j) => {
      const preds = j === 0 ? fs(`A${1640 + i * 10}`, 'A1420') : fs(`A${base + (j - 1) * 10}`)
      s.push({ code: `A${base + j * 10}`, name: `${name}, level ${lv}`, wbs: 'Interiors', days, preds })
    })
  })
  const trims = levels.map((_, i) => `A${1800 + i * 100 + 50}`)
  s.push(
    { code: 'A2500', name: 'Fire alarm and life safety test', wbs: 'Closeout', days: 5, preds: fs(...trims, 'A1700') },
    { code: 'A2510', name: 'Elevator inspection', wbs: 'Closeout', days: 3, preds: fs('A1540', 'A1700'), constraint: 'CS_MSO' },
    { code: 'A2520', name: 'Final building inspections', wbs: 'Closeout', days: 5, preds: fs('A2500', 'A2510', 'A1430') },
    { code: 'A2530', name: 'Certificate of occupancy', wbs: 'Closeout', days: 5, preds: fs('A2520') },
    { code: 'A2540', name: 'Punch list', wbs: 'Closeout', days: 10, preds: fs('A2520') },
    { code: 'A2550', name: 'Turnover to owner', wbs: 'Closeout', days: 0, kind: 'finish', preds: fs('A2530', 'A2540') },
  )
  return s
}

type Times = { es: number; ef: number; ls: number; lf: number }

function schedule(specs: Spec[], dur: Map<string, number>): { t: Map<string, Times>; finish: number } {
  const idx = new Map(specs.map((s, i) => [s.code, i]))
  const succs = new Map<string, { code: string; p: Pred }[]>()
  for (const s of specs) succs.set(s.code, [])
  for (const s of specs) for (const p of s.preds) succs.get(p.code)!.push({ code: s.code, p })
  const order = [...specs].sort((a, b) => idx.get(a.code)! - idx.get(b.code)!)
  const es = new Map<string, number>()
  const ef = new Map<string, number>()
  let finish = 0
  for (const s of order) {
    const d = dur.get(s.code)!
    let start = 0
    for (const p of s.preds) {
      const lag = p.lagDays ?? 0
      const ty = p.type ?? 'FS'
      if (ty === 'FS') start = Math.max(start, ef.get(p.code)! + lag)
      else if (ty === 'SS') start = Math.max(start, es.get(p.code)! + lag)
      else if (ty === 'FF') start = Math.max(start, ef.get(p.code)! + lag - d)
      else start = Math.max(start, es.get(p.code)! + lag - d)
    }
    es.set(s.code, start)
    ef.set(s.code, start + d)
    finish = Math.max(finish, start + d)
  }
  const t = new Map<string, Times>()
  const ls = new Map<string, number>()
  const lf = new Map<string, number>()
  for (let i = order.length - 1; i >= 0; i--) {
    const s = order[i]
    const d = dur.get(s.code)!
    let late = finish
    for (const { code, p } of succs.get(s.code)!) {
      const lag = p.lagDays ?? 0
      const ty = p.type ?? 'FS'
      if (ty === 'FS') late = Math.min(late, ls.get(code)! - lag)
      else if (ty === 'SS') late = Math.min(late, ls.get(code)! - lag + d)
      else if (ty === 'FF') late = Math.min(late, lf.get(code)! - lag)
      else late = Math.min(late, lf.get(code)! - lag + d)
    }
    lf.set(s.code, late)
    ls.set(s.code, late - d)
    t.set(s.code, { es: es.get(s.code)!, ef: ef.get(s.code)!, ls: late - d, lf: late })
  }
  return { t, finish }
}

type Event = { update: number; code: string; deltaDays: number }

const MIDRISE_EVENTS: Event[] = [
  { update: 1, code: 'A1110', deltaDays: 6 },
  { update: 2, code: 'A1510', deltaDays: 90 },
  { update: 2, code: 'A1210', deltaDays: 3 },
  { update: 3, code: 'A1510', deltaDays: 48 },
  { update: 3, code: 'A1300', deltaDays: 5 },
  { update: 3, code: 'A2110', deltaDays: -3 },
]

const HEADER = 'ERMHDR\t19.12\t2026-11-07\tProject\tadmin\tdemo\tdbxDatabaseNoName\tProject Management\tUSD'
const TASK_FIELDS = [
  'task_id', 'proj_id', 'wbs_id', 'task_code', 'task_name', 'task_type', 'status_code',
  'target_drtn_hr_cnt', 'remain_drtn_hr_cnt', 'phys_complete_pct', 'total_float_hr_cnt',
  'target_start_date', 'target_end_date', 'early_start_date', 'early_end_date',
  'late_start_date', 'late_end_date', 'act_start_date', 'act_end_date', 'cstr_type',
]

function table(name: string, fields: string[], rows: string[][]): string {
  return [`%T\t${name}`, `%F\t${fields.join('\t')}`, ...rows.map((r) => `%R\t${r.join('\t')}`)].join('\n')
}

function writeXer(opts: {
  projectName: string
  start: number
  dataDay: number
  specs: Spec[]
  baseline: Map<string, Times>
  current: Map<string, Times>
  dur: Map<string, number>
  finish: number
}): string {
  const { projectName, start, dataDay, specs, baseline, current, dur, finish } = opts
  const at = (day: number) => formatP6Date(start + day * DAY_MS + 8 * 3600 * 1000)
  const h = (days: number) => String(Math.round(days * HOURS_PER_DAY))
  const wbsNames = [...new Set(specs.map((s) => s.wbs))]
  const wbsId = new Map(wbsNames.map((w, i) => [w, String(2000 + i)]))
  const taskId = new Map(specs.map((s, i) => [s.code, String(10000 + i)]))

  const taskRows = specs.map((s) => {
    const b = baseline.get(s.code)!
    const c = current.get(s.code)!
    const d = dur.get(s.code)!
    const complete = c.ef <= dataDay && c.es < dataDay
    const started = c.es < dataDay
    const status = complete ? 'TK_Complete' : started ? 'TK_Active' : 'TK_NotStart'
    const remaining = complete ? 0 : started ? c.ef - dataDay : d
    const pct = complete ? 100 : started && d > 0 ? Math.round(((dataDay - c.es) / d) * 100) : 0
    const type = s.kind === 'start' ? 'TT_Mile' : s.kind === 'finish' ? 'TT_FinMile' : 'TT_Task'
    const esDay = started ? Math.max(c.es, 0) : c.es
    return [
      taskId.get(s.code)!, '1', wbsId.get(s.wbs)!, s.code, s.name, type, status,
      h(b.ef - b.es), h(remaining), String(pct), complete ? '' : h(c.ls - c.es),
      at(b.es), at(b.ef),
      complete ? at(c.es) : at(started ? dataDay : esDay), complete ? at(c.ef) : at(c.ef),
      complete ? '' : at(c.ls), complete ? '' : at(c.lf),
      started ? at(c.es) : '', complete ? at(c.ef) : '',
      s.constraint ?? '',
    ]
  })

  let predId = 50000
  const predRows: string[][] = []
  for (const s of specs) {
    for (const p of s.preds) {
      predRows.push([
        String(predId++), taskId.get(s.code)!, taskId.get(p.code)!, '1', '1',
        `PR_${p.type ?? 'FS'}`, h(p.lagDays ?? 0),
      ])
    }
  }

  return [
    HEADER,
    table('PROJECT', ['proj_id', 'proj_short_name', 'plan_start_date', 'last_recalc_date', 'scd_end_date'], [
      ['1', projectName, at(0), at(dataDay), at(finish)],
    ]),
    table('PROJWBS', ['wbs_id', 'proj_id', 'wbs_short_name', 'wbs_name', 'parent_wbs_id'],
      wbsNames.map((w) => [wbsId.get(w)!, '1', w.slice(0, 12).toUpperCase(), w, ''])),
    table('TASK', TASK_FIELDS, taskRows),
    table('TASKPRED', ['task_pred_id', 'task_id', 'pred_task_id', 'proj_id', 'pred_proj_id', 'pred_type', 'lag_hr_cnt'], predRows),
    '%E',
  ].join('\n')
}

function updates(projectName: string, specs: Spec[], events: Event[], startIso: string, count: number, everyDays: number): string[] {
  const start = Date.parse(`${startIso}T00:00:00Z`)
  const base = new Map(specs.map((s) => [s.code, s.days]))
  const baseline = schedule(specs, base).t
  const out: string[] = []
  for (let k = 1; k <= count; k++) {
    const dur = new Map(base)
    for (const e of events) if (e.update <= k) dur.set(e.code, Math.max(0, dur.get(e.code)! + e.deltaDays))
    const { t, finish } = schedule(specs, dur)
    out.push(writeXer({ projectName, start, dataDay: k * everyDays, specs, baseline, current: t, dur, finish }))
  }
  return out
}

export function midriseUpdates(): string[] {
  return updates('MIDRISE-42', midriseSpecs(), MIDRISE_EVENTS, '2026-03-02', 3, 30)
}

export function circularSample(): string {
  const specs = midriseSpecs()
  const xer = updates('MIDRISE-42', specs, [], '2026-03-02', 1, 30)[0]
  const ids = new Map(specs.map((s, i) => [s.code, String(10000 + i)]))
  const loop = `%R\t59999\t${ids.get('A1200')}\t${ids.get('A1220')}\t1\t1\tPR_FS\t0`
  return xer.replace('\n%E', `\n${loop}\n%E`)
}

function rng(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function largeSchedule(activities: number, seed = 7): string {
  const rand = rng(seed)
  const specs: Spec[] = [{ code: 'S0000', name: 'Start', wbs: 'Milestones', days: 0, kind: 'start', preds: [] }]
  const groups = Math.max(1, Math.round(activities / 50))
  for (let i = 1; i < activities - 1; i++) {
    const group = i % groups
    const prevInGroup = i - groups
    const preds: Pred[] = [{ code: prevInGroup >= 1 ? specs[prevInGroup].code : 'S0000' }]
    if (i > groups && rand() < 0.35) {
      const extra = specs[1 + Math.floor(rand() * (i - 1))].code
      if (extra !== preds[0].code) preds.push({ code: extra })
    }
    specs.push({ code: `S${String(i).padStart(5, '0')}`, name: `Activity ${i}`, wbs: `Area ${group + 1}`, days: 1 + Math.floor(rand() * 15), preds })
  }
  const hasSucc = new Set(specs.flatMap((s) => s.preds.map((p) => p.code)))
  specs.push({ code: 'S99999', name: 'Finish', wbs: 'Milestones', days: 0, kind: 'finish', preds: specs.filter((s) => !hasSucc.has(s.code)).map((s) => ({ code: s.code })) })
  return updates('LARGE', specs, [], '2026-01-05', 1, 60)[0]
}
