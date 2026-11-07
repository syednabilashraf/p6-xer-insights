import { useMemo, useState } from 'react'
import './App.css'
import { decodeXer } from './lib/xer.ts'
import { loadXer } from './lib/load.ts'
import type { Loaded } from './lib/load.ts'
import { analyse } from './lib/metrics.ts'
import type { Analysis } from './lib/metrics.ts'
import { runCpm } from './lib/cpm.ts'
import { buildSummary, fmtDate, llmPrompt, verifySummary } from './lib/summary.ts'
import { circularSample, largeSchedule, midriseUpdates } from './lib/generate.ts'
import { SCurve, FinishTrend } from './charts.tsx'

type Rejected = { name: string; reason: string }

const SAMPLE_FILES = [
  'midrise-update-1-2026-04-01.xer',
  'midrise-update-2-2026-05-01.xer',
  'midrise-update-3-2026-05-31.xer',
]
const REPO = 'https://github.com/syednabilashraf/p6-xer-insights'

const days = (hours: number) => Math.round(hours / 8)
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`

function loadAll(files: { name: string; text: string }[]) {
  const ok: Loaded[] = []
  const rejected: Rejected[] = []
  for (const f of files) {
    try {
      ok.push(loadXer(f.text, f.name))
    } catch (e) {
      rejected.push({ name: f.name, reason: e instanceof Error ? e.message : String(e) })
    }
  }
  return { ok, rejected }
}

const sampleFiles = () => midriseUpdates().map((text, i) => ({ name: SAMPLE_FILES[i], text }))

function timedLoad(files: { name: string; text: string }[]) {
  const t0 = performance.now()
  const result = loadAll(files.slice(0, 3))
  return { ...result, ms: performance.now() - t0 }
}

export default function App() {
  const [initial] = useState(() => timedLoad(sampleFiles()))
  const [loaded, setLoaded] = useState<Loaded[]>(initial.ok)
  const [rejected, setRejected] = useState<Rejected[]>([])
  const [parseMs, setParseMs] = useState(initial.ms)
  const [isSample, setIsSample] = useState(true)

  const analysis = useMemo(() => (loaded.length ? analyse(loaded.map((l) => l.schedule)) : null), [loaded])

  function ingest(files: { name: string; text: string }[], sample = false) {
    const { ok, rejected, ms } = timedLoad(files)
    setParseMs(ms)
    setLoaded(ok)
    setRejected(rejected)
    setIsSample(sample)
  }

  async function onFiles(list: FileList | null) {
    if (!list) return
    const files = await Promise.all(
      [...list].map(async (f) => ({ name: f.name, text: decodeXer(await f.arrayBuffer()) })),
    )
    ingest(files)
  }

  return (
    <div className="page">
      <header className="top">
        <div>
          <h1>Schedule update review</h1>
          <p className="lede">
            Upload one to three monthly Primavera P6 <code>.xer</code> updates. The parser and every number below are plain
            TypeScript running in your browser, so the files never leave your computer. The summary at the end only uses
            numbers the code computed.
          </p>
        </div>
      </header>

      <section className="controls">
        <label className="upload primary">
          Upload your .xer files
          <input type="file" accept=".xer" multiple onChange={(e) => onFiles(e.target.files)} />
        </label>
        <button onClick={() => ingest(sampleFiles(), true)}>Show the sample project</button>
        <button onClick={() => ingest([{ name: 'broken-circular-logic.xer', text: circularSample() }])}>
          Try a broken file
        </button>
        <span className="hint">
          Sample files: {SAMPLE_FILES.map((f, i) => (
            <a key={f} href={`/samples/${f}`} download>{`update ${i + 1}`}</a>
          ))}
        </span>
      </section>

      {isSample && rejected.length === 0 && (
        <div className="notice">
          You're looking at a generated sample: a 42-unit midrise with three monthly updates, where a switchgear delivery
          slips and eats into its float. Upload your own files to replace it.
        </div>
      )}

      {rejected.map((r) => (
        <div key={r.name} className="rejected">
          <strong>{r.name} was rejected.</strong> {r.reason}
          {r.reason.startsWith('Circular') ? ' Fix the loop in P6 and export the file again.' : ''}
        </div>
      ))}

      {analysis && <Report a={analysis} loaded={loaded} parseMs={parseMs} />}
      <Benchmark />

      <footer>
        A sample by Syed Nabil Ashraf. <a href={REPO}>Source on GitHub</a>. The sample schedules are generated, not real
        project data.
      </footer>
    </div>
  )
}

function Report({ a, loaded, parseMs }: { a: Analysis; loaded: Loaded[]; parseMs: number }) {
  const m = a.metrics[a.metrics.length - 1]
  const prev = a.metrics.length > 1 ? a.metrics[a.metrics.length - 2] : null
  const c = a.comparisons[a.comparisons.length - 1]
  const checksPassed = m.checks.filter((x) => x.status === 'pass').length
  const latest = a.schedules[a.schedules.length - 1]

  return (
    <>
      {loaded.some((l) => l.warnings.length > 0) && (
        <div className="warnings">
          <strong>Data warnings</strong>
          <ul>
            {loaded.flatMap((l) => l.warnings.slice(0, 6).map((w, i) => <li key={`${l.name}-${i}`}>{l.name}: {w}</li>))}
          </ul>
        </div>
      )}

      <section className="meta">
        <strong>{m.projectName}</strong>
        {a.metrics.map((x, i) => (
          <span key={x.dataDate} className="chip">Update {i + 1}: {fmtDate(x.dataDate)}</span>
        ))}
        <span className="muted">
          Read and checked {loaded.length} file{loaded.length === 1 ? '' : 's'} in {Math.round(parseMs)} ms ({latest.activities.length} activities,{' '}
          {latest.relationships.length} links in the latest), metrics in {Math.round(a.ms)} ms. Float source:{' '}
          {m.floatSource === 'P6' ? 'P6 total float' : 'computed CPM'}.
        </span>
      </section>

      <section className="kpis">
        <Kpi label="Forecast finish" value={fmtDate(m.forecastFinish)} sub={m.hasPlannedDates ? `${signed(m.finishVarianceDays)} days vs planned ${fmtDate(m.plannedFinish)}` : 'no planned dates in the file'} tone={m.finishVarianceDays > 0 ? 'bad' : 'good'} />
        <Kpi label="Movement since last update" value={c ? `${signed(c.finishMovementDays)} days` : '—'} sub={prev ? `since ${fmtDate(prev.dataDate)}` : 'needs two updates'} tone={c && c.finishMovementDays > 0 ? 'bad' : 'good'} />
        <Kpi label="Critical / near-critical" value={`${m.criticalCount} / ${m.nearCriticalCount}`} sub="open activities with ≤ 0 / ≤ 10 days float" />
        <Kpi label="Progress" value={`${m.pctActual}%`} sub={`vs ${m.pctPlanned}% planned`} tone={m.pctActual < m.pctPlanned ? 'bad' : 'good'} />
        <Kpi label={m.periodStart ? 'Finishes achieved this period' : 'Finishes achieved to date'} value={`${m.finishesAchieved} of ${m.finishesPlanned}`} sub={`starts: ${m.startsAchieved} of ${m.startsPlanned}`} />
        <Kpi label="Schedule checks" value={`${checksPassed} of ${m.checks.length} pass`} sub="logic, constraints, float, dates" tone={checksPassed === m.checks.length ? 'good' : 'warn'} />
      </section>

      <section className="grid2">
        <div className="card">
          <h2>Progress S-curve</h2>
          <SCurve a={a} />
          <p className="legend"><span className="swatch planned-sw" /> planned (from target dates) <span className="swatch actual-sw" /> actual at each data date</p>
        </div>
        <div className="card">
          <h2>Forecast finish by update</h2>
          <FinishTrend a={a} />
        </div>
      </section>

      {c && (
        <section className="card">
          <h2>What changed since {prev ? fmtDate(prev.dataDate) : 'the last update'}</h2>
          <ul className="changes">
            <li>Forecast finish moved <strong>{signed(c.finishMovementDays)} days</strong>, to {fmtDate(m.forecastFinish)}.</li>
            {c.floatLosers.map((x) => (
              <li key={x.activity.id}>
                <strong>{x.activity.code} {x.activity.name}</strong> lost {x.lostDays} days of float; {x.floatDays} days left.
              </li>
            ))}
            {c.joinedCritical.length > 0 && (
              <li>Joined the critical path: {c.joinedCritical.map((x) => `${x.code} ${x.name}`).join(', ')}.</li>
            )}
            {c.slipped.filter((x) => !c.floatLosers.some((l) => l.activity.id === x.activity.id)).map((x) => (
              <li key={`s${x.activity.id}`}>{x.activity.code} {x.activity.name} now finishes {x.slipDays} days later.</li>
            ))}
          </ul>
        </section>
      )}

      <SummaryPanel a={a} />

      <section className="grid2">
        <div className="card">
          <h2>Critical path ({m.critical.length} open activities)</h2>
          <table>
            <thead><tr><th>ID</th><th>Activity</th><th>Start</th><th>Finish</th><th>Float</th></tr></thead>
            <tbody>
              {m.critical.slice(0, 14).map((x) => (
                <tr key={x.id}>
                  <td className="mono">{x.code}</td>
                  <td>{x.name}</td>
                  <td>{x.earlyStart ? fmtDate(x.earlyStart) : ''}</td>
                  <td>{x.earlyFinish ? fmtDate(x.earlyFinish) : ''}</td>
                  <td>{days(m.float.get(x.id) ?? 0)}d</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="card">
          <h2>Schedule checks</h2>
          <table>
            <thead><tr><th></th><th>Check</th><th>Count</th><th>Examples</th></tr></thead>
            <tbody>
              {m.checks.map((x) => (
                <tr key={x.key}>
                  <td><span className={`pill ${x.status}`}>{x.status}</span></td>
                  <td>{x.label}<div className="muted small">{x.detail}</div></td>
                  <td>{x.count} / {x.total}</td>
                  <td className="small">{x.examples.slice(0, 2).join('; ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  )
}

function Kpi({ label, value, sub, tone }: { label: string; value: string; sub: string; tone?: 'good' | 'bad' | 'warn' }) {
  return (
    <div className={`kpi ${tone ?? ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      <div className="kpi-sub">{sub}</div>
    </div>
  )
}

function SummaryPanel({ a }: { a: Analysis }) {
  const i = a.metrics.length - 1
  const summary = useMemo(
    () => buildSummary(a.metrics[i], a.comparisons[i], i ? a.metrics[i - 1] : null),
    [a, i],
  )
  const [text, setText] = useState(summary.text)
  const [shownFor, setShownFor] = useState(summary.text)
  if (shownFor !== summary.text) {
    setShownFor(summary.text)
    setText(summary.text)
  }
  const v = verifySummary(text, summary.facts)
  return (
    <section className="card">
      <h2>Executive summary</h2>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} />
      {v.unknown.length === 0 ? (
        <p className="verified">✓ All {v.checked} numbers and dates trace back to the computed metrics.</p>
      ) : (
        <p className="unverified">
          ✗ Rejected: {v.unknown.join(', ')} {v.unknown.length === 1 ? "isn't" : "aren't"} in the computed metrics. An AI-written
          summary with this problem would be regenerated before anyone sees it.
        </p>
      )}
      <p className="muted small">Try editing a number in the text above to see the check catch it.</p>
      <details>
        <summary>How the AI version works</summary>
        <p className="small">
          The model gets only the computed facts below and a fixed template. Its answer goes through the same number check
          before it's shown. Calculations never happen in the model.
        </p>
        <pre>{llmPrompt(summary.facts)}</pre>
      </details>
    </section>
  )
}

function Benchmark() {
  const [result, setResult] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  function run(n: number) {
    setBusy(true)
    setTimeout(() => {
      const text = largeSchedule(n)
      const t0 = performance.now()
      const loaded = loadXer(text, 'large.xer')
      const t1 = performance.now()
      analyse([loaded.schedule])
      const t2 = performance.now()
      runCpm(loaded.schedule.activities, loaded.schedule.relationships)
      const t3 = performance.now()
      setResult(
        `${n.toLocaleString()} activities and ${loaded.schedule.relationships.length.toLocaleString()} links: read and checked in ${Math.round(t1 - t0)} ms, metrics in ${Math.round(t2 - t1)} ms, full critical-path calculation in ${Math.round(t3 - t2)} ms.`,
      )
      setBusy(false)
    }, 30)
  }
  return (
    <section className="card bench">
      <h2>Large schedules</h2>
      <p className="small muted">Generates a synthetic schedule in your browser, then times the same parser and calculations on it.</p>
      <button disabled={busy} onClick={() => run(10000)}>Run 10,000-activity test</button>
      <button disabled={busy} onClick={() => run(50000)}>Run 50,000-activity test</button>
      {busy && <p className="small">Running…</p>}
      {result && <p><strong>{result}</strong></p>}
    </section>
  )
}
