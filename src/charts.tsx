import type { Analysis } from './lib/metrics.ts'
import type { FloatBucket } from './lib/checks.ts'
import { fmtDate } from './lib/summary.ts'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function monthTicks(from: number, to: number): { t: number; label: string }[] {
  const out: { t: number; label: string }[] = []
  const d = new Date(from)
  let y = d.getUTCFullYear()
  let m = d.getUTCMonth() + 1
  for (;;) {
    if (m > 11) {
      m = 0
      y++
    }
    const t = Date.UTC(y, m, 1)
    if (t > to) break
    out.push({ t, label: `${MONTHS[m]} ${String(y).slice(2)}` })
    m++
  }
  return out
}

export function SCurve({ a }: { a: Analysis }) {
  const W = 640
  const H = 280
  const pad = { l: 44, r: 16, t: 16, b: 32 }
  const pts = a.sCurve.planned
  if (pts.length < 2) return null
  const from = pts[0].t
  const to = pts[pts.length - 1].t
  const x = (t: number) => pad.l + ((t - from) / (to - from)) * (W - pad.l - pad.r)
  const y = (p: number) => H - pad.b - (p / 100) * (H - pad.t - pad.b)
  const planned = pts.map((p) => `${x(p.t)},${y(p.pct)}`).join(' ')
  const actualPts = [{ t: from, pct: 0 }, ...a.sCurve.actual]
  const actual = actualPts.map((p) => `${x(p.t)},${y(p.pct)}`).join(' ')
  const last = a.sCurve.actual[a.sCurve.actual.length - 1]
  const ticks = monthTicks(from, to)
  const stride = Math.ceil(ticks.length / 9)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Progress S-curve">
      {[0, 25, 50, 75, 100].map((p) => (
        <g key={p}>
          <line x1={pad.l} x2={W - pad.r} y1={y(p)} y2={y(p)} className="grid" />
          <text x={pad.l - 8} y={y(p) + 4} className="axis" textAnchor="end">{p}%</text>
        </g>
      ))}
      {ticks.map((tk, i) =>
        i % stride === 0 ? (
          <text key={tk.t} x={x(tk.t)} y={H - 10} className="axis" textAnchor="middle">{tk.label}</text>
        ) : null,
      )}
      <line x1={x(last.t)} x2={x(last.t)} y1={pad.t} y2={H - pad.b} className="datadate" />
      <text x={x(last.t) + 4} y={pad.t + 10} className="axis">data date</text>
      <polyline points={planned} className="planned" />
      <polyline points={actual} className="actual" />
      {a.sCurve.actual.map((p) => (
        <g key={p.t}>
          <circle cx={x(p.t)} cy={y(p.pct)} r={4} className="actual-dot" />
          {p.pct > 0 && <text x={x(p.t) - 6} y={y(p.pct) - 8} className="axis" textAnchor="end">{p.pct}%</text>}
        </g>
      ))}
    </svg>
  )
}

export function FinishTrend({ a }: { a: Analysis }) {
  const W = 400
  const H = 280
  const pad = { l: 16, r: 16, t: 36, b: 56 }
  const ms = a.metrics
  const planned = ms[ms.length - 1].plannedFinish
  const values = [planned, ...ms.map((m) => m.forecastFinish)]
  const lo = Math.min(...values)
  const hi = Math.max(...values)
  const span = Math.max(hi - lo, 7 * 86400000)
  const y = (t: number) => H - pad.b - ((t - lo) / span) * (H - pad.t - pad.b)
  const step = (W - pad.l - pad.r) / ms.length
  const x = (i: number) => pad.l + step * (i + 0.5)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Forecast finish by update">
      <line x1={pad.l} x2={W - pad.r} y1={y(planned)} y2={y(planned)} className="planned-line" />
      <text x={pad.l} y={y(planned) - 6} className="axis">planned finish {fmtDate(planned)}</text>
      <polyline points={ms.map((m, i) => `${x(i)},${y(m.forecastFinish)}`).join(' ')} className="actual" />
      {ms.map((m, i) => (
        <g key={m.dataDate}>
          <circle cx={x(i)} cy={y(m.forecastFinish)} r={5} className="actual-dot" />
          <text x={x(i)} y={y(m.forecastFinish) - 12} className="label" textAnchor="middle">
            {m.finishVarianceDays > 0 ? '+' : ''}{m.finishVarianceDays}d
          </text>
          <text x={x(i)} y={H - 32} className="axis" textAnchor="middle">Update {i + 1}</text>
          <text x={x(i)} y={H - 16} className="axis" textAnchor="middle">{fmtDate(m.dataDate)}</text>
        </g>
      ))}
    </svg>
  )
}

const BAR_CLASS: Record<string, string> = { negative: 'bar bar-neg', high: 'bar bar-high' }

function topRounded(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, h, w / 2)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

export function FloatChart({ buckets }: { buckets: FloatBucket[] }) {
  const W = 340
  const H = 220
  const pad = { l: 8, r: 8, t: 26, b: 54 }
  const max = Math.max(1, ...buckets.map((b) => b.count))
  const step = (W - pad.l - pad.r) / buckets.length
  const barW = step * 0.62
  const base = H - pad.b
  const y = (n: number) => base - (n / max) * (base - pad.t)
  const summary = buckets.map((b) => `${b.label} days: ${b.count}`).join(', ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart floatchart" role="img" aria-label={`Open activities by total float. ${summary}`}>
      {buckets.map((b, i) => {
        const x = pad.l + step * i + (step - barW) / 2
        const top = y(b.count)
        const tip = `${b.label} working days: ${b.count} open ${b.count === 1 ? 'activity' : 'activities'}`
        return (
          <g key={b.key} className="col">
            <title>{tip}</title>
            <rect x={pad.l + step * i} y={pad.t - 20} width={step} height={base - pad.t + 20} className="hit" />
            {b.count > 0 && <path d={topRounded(x, top, barW, base - top)} className={BAR_CLASS[b.key] ?? 'bar'} />}
            <text x={x + barW / 2} y={top - 6} className="count" textAnchor="middle">{b.count}</text>
            <text x={x + barW / 2} y={base + 18} className="axis" textAnchor="middle">{b.label}</text>
          </g>
        )
      })}
      <line x1={pad.l} x2={W - pad.r} y1={base} y2={base} className="baseline" />
      <text x={W / 2} y={H - 12} className="axis" textAnchor="middle">total float in working days (8-hour days)</text>
    </svg>
  )
}
