import { useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { decodeXer } from './lib/xer.ts'
import { checkFiles, MAX_CHECK_FILES } from './lib/checkfile.ts'
import type { FileCheck } from './lib/checkfile.ts'
import type { CheckResult, FloatBucket } from './lib/checks.ts'
import { brokenRowsSample } from './lib/generate.ts'
import { FloatChart } from './charts.tsx'
import { BROKEN_SAMPLE, PUBLIC_SAMPLES } from './lib/samples.ts'

const BROKEN_SHOWN = 10
const EXAMPLES_SHOWN = 3
const BAR_SHOWN = 5
const MAX_EXPANDED = 500

const plural = (n: number, one: string, many: string) => `${n.toLocaleString()} ${n === 1 ? one : many}`
const share = (n: number, total: number) => (n > 0 && total > 0 ? ` (${Math.round((n / total) * 1000) / 10}%)` : '')

const BAR_RANGE: Record<string, string> = {
  negative: 'negative float',
  zero: '0 days of float',
  low: '1–10 days of float',
  mid: '11–44 days of float',
  high: 'more than 44 days of float',
}

type Shown = 'public' | 'broken' | 'upload'

async function fetchPublicSamples(): Promise<FileCheck[]> {
  const files = await Promise.all(
    PUBLIC_SAMPLES.map(async (s) => {
      const res = await fetch(`/samples/${s.file}`)
      if (!res.ok) throw new Error(`Couldn't download ${s.file} (HTTP ${res.status})`)
      return { name: s.file, text: decodeXer(await res.arrayBuffer()) }
    }),
  )
  return checkFiles(files)
}

export function CheckMode() {
  const [results, setResults] = useState<FileCheck[]>([])
  const [shown, setShown] = useState<Shown>('public')
  const [busy, setBusy] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const [run, setRun] = useState(0)
  const request = useRef(0)
  const root = useRef<HTMLDivElement>(null)

  function show(next: FileCheck[], kind: Shown) {
    setResults(next)
    setRun((n) => n + 1)
    setShown(kind)
    setError(null)
    setBusy(false)
  }

  function loadPublic(id: number) {
    fetchPublicSamples()
      .then((r) => id === request.current && show(r, 'public'))
      .catch((e) => {
        if (id !== request.current) return
        setResults([])
        setShown('public')
        setError(e instanceof Error ? e.message : String(e))
        setBusy(false)
      })
  }

  function showPublic() {
    setBusy(true)
    loadPublic(++request.current)
  }

  function showBroken() {
    request.current++
    show(checkFiles([{ name: BROKEN_SAMPLE, text: brokenRowsSample() }]), 'broken')
  }

  async function onFiles(list: FileList | null) {
    setDragging(false)
    if (!list || list.length === 0) return
    const id = ++request.current
    const files = await Promise.all(
      [...list].map(async (f) => ({ name: f.name, text: decodeXer(await f.arrayBuffer()) })),
    )
    if (id === request.current) show(checkFiles(files), 'upload')
  }

  useEffect(() => loadPublic(++request.current), [])

  useEffect(() => {
    let depth = 0
    const active = (e: DragEvent) => root.current?.offsetParent != null && !!e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => {
      if (!active(e)) return
      depth++
      setDragging(true)
    }
    const leave = (e: DragEvent) => {
      if (!active(e)) return
      depth = Math.max(0, depth - 1)
      if (depth === 0) setDragging(false)
    }
    const over = (e: DragEvent) => {
      if (!active(e)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
    }
    const drop = (e: DragEvent) => {
      if (!active(e)) return
      e.preventDefault()
      depth = 0
      onFiles(e.dataTransfer!.files)
    }
    const handlers = { dragenter: enter, dragleave: leave, dragover: over, drop } as const
    for (const [name, fn] of Object.entries(handlers)) window.addEventListener(name, fn as EventListener)
    return () => {
      for (const [name, fn] of Object.entries(handlers)) window.removeEventListener(name, fn as EventListener)
    }
  }, [])

  return (
    <div ref={root}>
      <header className="top">
        <h1>Schedule file checker</h1>
        <p className="lede">
          Load one or more Primavera P6 <code>.xer</code> files. Each file gets its own card: the rows that couldn't be read
          cleanly (with their line numbers), three schedule checks (missing links, negative float, high float) and a chart of
          total float.
        </p>
      </header>

      <section className="controls">
        <div className={`dropzone${dragging ? ' over' : ''}`}>
          <label className="upload primary">
            Upload .xer files
            <input
              id="check-files"
              name="check-files"
              type="file"
              accept=".xer"
              multiple
              aria-label={`Upload up to ${MAX_CHECK_FILES} .xer files to check`}
              onChange={(e) => {
                onFiles(e.target.files)
                e.target.value = ''
              }}
            />
          </label>
          <span className="small muted drop-hint">{dragging ? 'Drop to check them' : 'or drop them here'}</span>
        </div>
        <button onClick={showPublic}>Show the 2 public files</button>
        <button onClick={showBroken}>Show a file with broken rows</button>
        <span className="hint">
          Download:
          {PUBLIC_SAMPLES.map((s) => (
            <a key={s.file} href={`/samples/${s.file}`} download>{s.file}</a>
          ))}
          <a href={`/samples/${BROKEN_SAMPLE}`} download>{BROKEN_SAMPLE}</a>
        </span>
      </section>

      {shown === 'public' && !error && (
        <div className="notice">
          These are two public P6 exports: {PUBLIC_SAMPLES.map((s, i) => (
            <span key={s.file}>
              {i ? ' and ' : ''}
              <a href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
            </span>
          ))}{' '}
          (both MIT-licensed test files). Neither has negative float, so that check shows 0. Upload your own files to replace
          them.
        </div>
      )}
      {shown === 'broken' && (
        <div className="notice">
          This file is generated, not real project data. It has one bad row for each problem the checker looks for, and its
          float values are made up so the float checks have something to flag.
        </div>
      )}
      {error && <div className="rejected">{error}</div>}
      {busy && <p className="muted">Loading the sample files…</p>}

      {results.map((r, i) => (
        <FileCard key={`${run}-${i}`} r={r} />
      ))}
      {dragging && <div className="dropping" aria-hidden="true"><span>Drop .xer files to check them</span></div>}
    </div>
  )
}

function FileCard({ r }: { r: FileCheck }) {
  if (!r.ok) {
    return (
      <section className="card filecard">
        <h2>{r.name}</h2>
        <div className="rejected">
          <strong>This file couldn't be checked.</strong> {r.error}
          {r.error.endsWith('.') ? '' : '.'}
          {r.error.startsWith('Circular') ? ' Fix the loop in P6 and export the file again.' : ''}
        </div>
      </section>
    )
  }
  const s = r.loaded.schedule
  const broken = s.broken
  const checks = [r.missingLinks, r.negativeFloat, r.highFloat]
  return (
    <section className="card filecard">
      <h2>{r.name}</h2>
      <Verdict checks={checks} broken={broken.length} />
      <p className="muted small">
        Project: {s.projectName} · {plural(s.activities.length, 'activity', 'activities')} · {plural(s.relationships.length, 'link', 'links')} · read and checked in{' '}
        {Math.max(1, Math.round(r.ms))} ms
      </p>
      {s.fileWarnings.length > 0 && (
        <div className="warnings">
          <ul>{s.fileWarnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
        </div>
      )}

      <h3>1. Broken rows: {broken.length}</h3>
      {broken.length === 0 ? (
        <p className="small">
          None. Every row has a value for each field, readable dates and numbers, a unique activity ID and code, a known
          relationship type, and links only to activities in the file.
        </p>
      ) : (
        <ShowAll
          items={broken}
          limit={BROKEN_SHOWN}
          render={(shown, id) => (
            <table className="broken">
              <thead><tr><th>Line</th><th>Table</th><th>Activity</th><th>Reason</th></tr></thead>
              <tbody id={id}>
                {shown.map((b) => (
                  <tr key={b.line}>
                    <td className="mono">{b.line}</td>
                    <td className="mono">{b.table || '—'}</td>
                    <td className="activity">{b.activity || <span className="muted">—</span>}</td>
                    <td>{b.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        />
      )}

      <div className="grid2 checkgrid">
        <div>
          <h3>2. Checks</h3>
          <p className="muted small dcma">Thresholds follow the DCMA 14-point assessment. Warn means above zero but within its 5% limit.</p>
          {checks.map((c) => <Check key={c.key} c={c} />)}
          <p className="muted small">
            {r.openCount === 0
              ? 'There are no open activities, so there is no float to check.'
              : r.floatSource === 'P6'
              ? `Float comes from the total float P6 stored in the file.${r.missingStoredFloat ? ` ${r.missingStoredFloat} open ${r.missingStoredFloat === 1 ? 'activity has' : 'activities have'} no stored float and ${r.missingStoredFloat === 1 ? 'counts' : 'count'} as 0.` : ''}`
              : 'The file has no stored total float for most open activities, so float is computed by the built-in critical-path calculation (8-hour days, calendars ignored).'}
          </p>
        </div>
        <div>
          <h3>3. Total float of the {r.openCount} open {r.openCount === 1 ? 'activity' : 'activities'}</h3>
          {r.openCount > 0 ? <FloatPanel buckets={r.buckets} /> : <p className="small muted">Every activity is complete, so there's no float to chart.</p>}
        </div>
      </div>
    </section>
  )
}

function Verdict({ checks, broken }: { checks: CheckResult[]; broken: number }) {
  const n = (status: CheckResult['status']) => checks.filter((c) => c.status === status).length
  const tally = (count: number, tone: string, text: string) => (
    <span className={`tally ${count ? tone : 'none'}`}>{text}</span>
  )
  return (
    <p className="verdict">
      {tally(n('fail'), 'fail', `${n('fail')} failed`)}
      {tally(n('warn'), 'warn', plural(n('warn'), 'warning', 'warnings'))}
      {tally(n('pass'), 'pass', `${n('pass')} passed`)}
      {tally(broken, 'warn', plural(broken, 'broken row', 'broken rows'))}
    </p>
  )
}

function FloatPanel({ buckets }: { buckets: FloatBucket[] }) {
  const [selected, setSelected] = useState<string | null>(null)
  const bucket = buckets.find((b) => b.key === selected)
  return (
    <div className="floatpanel">
      <FloatChart buckets={buckets} selected={selected} onSelect={(key) => setSelected(key === selected ? null : key)} />
      {bucket ? (
        <div className="barlist">
          <div className="barlist-head">
            <strong className="small">{plural(bucket.count, 'open activity', 'open activities')} with {BAR_RANGE[bucket.key]}</strong>
            <button type="button" className="more" onClick={() => setSelected(null)}>Hide</button>
          </div>
          <ExampleList key={bucket.key} items={bucket.activities} limit={BAR_SHOWN} />
        </div>
      ) : (
        <p className="muted small">Click a bar to list its activities.</p>
      )}
    </div>
  )
}

function ShowAll<T>({ items, limit, render }: { items: T[]; limit: number; render: (shown: T[], id: string) => ReactNode }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const button = useRef<HTMLButtonElement>(null)
  function toggle() {
    setOpen(!open)
    if (open) requestAnimationFrame(() => button.current?.scrollIntoView({ block: 'nearest' }))
  }
  return (
    <>
      {render(items.slice(0, open ? MAX_EXPANDED : limit), id)}
      {open && items.length > MAX_EXPANDED && (
        <p className="muted small">Showing the first {MAX_EXPANDED} of {items.length.toLocaleString()}.</p>
      )}
      {items.length > limit && (
        <button ref={button} type="button" className="more" aria-expanded={open} aria-controls={id} onClick={toggle}>
          {open ? 'Show fewer' : items.length > MAX_EXPANDED ? `Show the first ${MAX_EXPANDED}` : `Show all ${items.length.toLocaleString()}`}
        </button>
      )}
    </>
  )
}

function ExampleList({ items, limit = EXAMPLES_SHOWN }: { items: string[]; limit?: number }) {
  return (
    <ShowAll
      items={items}
      limit={limit}
      render={(shown, id) => (
        <ul id={id} className="examples small">
          {shown.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      )}
    />
  )
}

function Check({ c }: { c: CheckResult }) {
  const extra = c.extra
  return (
    <div className={`check ${c.status}`}>
      <div className="check-head">
        <span className={`pill ${c.status}`}>{c.status}</span>
        <strong>{c.label}</strong>
        <span>
          {c.count} of {plural(c.total, 'open activity', 'open activities')}{share(c.count, c.total)}
        </span>
      </div>
      <div className="muted small">{c.detail}</div>
      {c.examples.length > 0 && <ExampleList items={c.examples} />}
      {extra && (
        <div className={`small ${extra.count ? 'bad-text' : 'muted'}`}>
          {extra.count ? `Plus ${extra.count} ${extra.label}:` : `No links point to activities that aren't in the file.`}
        </div>
      )}
      {extra && extra.count > 0 && <ExampleList items={extra.examples} />}
    </div>
  )
}
