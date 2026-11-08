import type { Activity, Relationship, Schedule } from './schedule.ts'

export type CpmTimes = { es: number; ef: number; ls: number; lf: number; tf: number }

export type CpmResult = {
  times: Map<string, CpmTimes>
  finishHours: number
  order: string[]
}

export class CircularLogicError extends Error {
  readonly loop: string[]
  constructor(loop: string[]) {
    super(`Circular logic: ${loop.join(' → ')}`)
    this.loop = loop
  }
}

type Edge = { to: string; type: Relationship['type']; lag: number }

export function findLoop(ids: string[], rels: Relationship[]): string[] | null {
  const out = new Map<string, string[]>()
  for (const id of ids) out.set(id, [])
  for (const r of rels) out.get(r.pred)?.push(r.succ)
  const state = new Map<string, 0 | 1 | 2>()
  const parent = new Map<string, string>()
  for (const root of ids) {
    if (state.get(root)) continue
    const stack: [string, number][] = [[root, 0]]
    state.set(root, 1)
    while (stack.length) {
      const top = stack[stack.length - 1]
      const [node, idx] = top
      const next = out.get(node) ?? []
      if (idx < next.length) {
        top[1]++
        const child = next[idx]
        const s = state.get(child) ?? 0
        if (s === 0) {
          state.set(child, 1)
          parent.set(child, node)
          stack.push([child, 0])
        } else if (s === 1) {
          const loop = [child]
          let cur = node
          while (cur !== child) {
            loop.push(cur)
            cur = parent.get(cur)!
          }
          loop.push(child)
          return loop.reverse()
        }
      } else {
        state.set(node, 2)
        stack.pop()
      }
    }
  }
  return null
}

export function remainingDuration(a: Activity): number {
  if (a.status === 'complete') return 0
  return Math.max(0, a.remainingHours)
}

export function runCpm(activities: Activity[], rels: Relationship[]): CpmResult {
  const ids = activities.map((a) => a.id)
  const byId = new Map(activities.map((a) => [a.id, a]))
  const succs = new Map<string, Edge[]>()
  const preds = new Map<string, Edge[]>()
  const indeg = new Map<string, number>()
  for (const id of ids) {
    succs.set(id, [])
    preds.set(id, [])
    indeg.set(id, 0)
  }
  for (const r of rels) {
    succs.get(r.pred)!.push({ to: r.succ, type: r.type, lag: r.lagHours })
    preds.get(r.succ)!.push({ to: r.pred, type: r.type, lag: r.lagHours })
    indeg.set(r.succ, indeg.get(r.succ)! + 1)
  }

  const order: string[] = []
  const queue: string[] = ids.filter((id) => indeg.get(id) === 0)
  for (let q = 0; q < queue.length; q++) {
    const id = queue[q]
    order.push(id)
    for (const e of succs.get(id)!) {
      const d = indeg.get(e.to)! - 1
      indeg.set(e.to, d)
      if (d === 0) queue.push(e.to)
    }
  }
  if (order.length !== ids.length) {
    throw new CircularLogicError(
      (findLoop(ids, rels) ?? []).map((id) => byId.get(id)?.code ?? id),
    )
  }

  const dur = new Map(activities.map((a) => [a.id, remainingDuration(a)]))
  const es = new Map<string, number>()
  const ef = new Map<string, number>()
  let finishHours = 0
  for (const id of order) {
    const a = byId.get(id)!
    const d = dur.get(id)!
    let start = 0
    if (a.status !== 'complete') {
      for (const p of preds.get(id)!) {
        const pes = es.get(p.to)!
        const pef = ef.get(p.to)!
        if (p.type === 'FS') start = Math.max(start, pef + p.lag)
        else if (p.type === 'SS') start = Math.max(start, pes + p.lag)
        else if (p.type === 'FF') start = Math.max(start, pef + p.lag - d)
        else start = Math.max(start, pes + p.lag - d)
      }
    }
    es.set(id, start)
    ef.set(id, start + d)
    finishHours = Math.max(finishHours, start + d)
  }

  const times = new Map<string, CpmTimes>()
  const lf = new Map<string, number>()
  const ls = new Map<string, number>()
  for (let i = order.length - 1; i >= 0; i--) {
    const id = order[i]
    const d = dur.get(id)!
    let late = finishHours
    for (const s of succs.get(id)!) {
      const sls = ls.get(s.to)!
      const slf = lf.get(s.to)!
      if (s.type === 'FS') late = Math.min(late, sls - s.lag)
      else if (s.type === 'SS') late = Math.min(late, sls - s.lag + d)
      else if (s.type === 'FF') late = Math.min(late, slf - s.lag)
      else late = Math.min(late, slf - s.lag + d)
    }
    lf.set(id, late)
    ls.set(id, late - d)
    times.set(id, {
      es: es.get(id)!,
      ef: ef.get(id)!,
      ls: late - d,
      lf: late,
      tf: late - d - es.get(id)!,
    })
  }
  return { times, finishHours, order }
}

export type FloatSource = 'P6' | 'computed'

export type ScheduleFloat = {
  float: Map<string, number>
  source: FloatSource
  finishHours: number | null
  missingStored: number
}

const MIN_STORED_FLOAT_SHARE = 0.9

export function scheduleFloat(s: Schedule): ScheduleFloat {
  const acts = s.activities.filter((a) => a.type !== 'wbs' && a.type !== 'loe')
  const open = acts.filter((a) => a.status !== 'complete')
  const stored = open.filter((a) => a.totalFloatHours !== null).length
  const float = new Map<string, number>()
  if (open.length > 0 && stored / open.length >= MIN_STORED_FLOAT_SHARE) {
    for (const a of open) float.set(a.id, a.totalFloatHours ?? 0)
    return { float, source: 'P6', finishHours: null, missingStored: open.length - stored }
  }
  const cpm = runCpm(acts, s.relationships)
  for (const a of open) float.set(a.id, cpm.times.get(a.id)!.tf)
  return { float, source: 'computed', finishHours: cpm.finishHours, missingStored: open.length - stored }
}
