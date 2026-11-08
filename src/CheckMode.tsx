import { useEffect, useRef, useState } from 'react'
import { decodeXer } from './lib/xer.ts'
import { checkFiles, MAX_CHECK_FILES } from './lib/checkfile.ts'
import type { FileCheck } from './lib/checkfile.ts'
import type { CheckResult } from './lib/checks.ts'
import { brokenRowsSample } from './lib/generate.ts'
import { FloatChart } from './charts.tsx'
import { BROKEN_SAMPLE, PUBLIC_SAMPLES } from './lib/samples.ts'

const MAX_BROKEN_SHOWN = 50

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

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
  const request = useRef(0)

  function show(next: FileCheck[], kind: Shown) {
    setResults(next)
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
    if (!list || list.length === 0) return
    const id = ++request.current
    const files = await Promise.all(
      [...list].map(async (f) => ({ name: f.name, text: decodeXer(await f.arrayBuffer()) })),
    )
    if (id === request.current) show(checkFiles(files), 'upload')
  }

  useEffect(() => loadPublic(++request.current), [])

  return (
    <>
      <header className="top">
        <h1>Schedule file checker</h1>
        <p className="lede">
          Load one or more Primavera P6 <code>.xer</code> files. Each file gets its own card: the rows that couldn't be read
          cleanly (with their line numbers), three schedule checks (missing links, negative float, high float) and a chart of
          total float. It runs in your browser, so the files never leave your computer.
        </p>
      </header>

      <section className="controls">
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
        <FileCard key={`${r.name}-${i}`} r={r} />
      ))}
    </>
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
  return (
    <section className="card filecard">
      <h2>{r.name}</h2>
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
        <>
          <table className="broken">
            <thead><tr><th>Line</th><th>Table</th><th>Reason</th></tr></thead>
            <tbody>
              {broken.slice(0, MAX_BROKEN_SHOWN).map((b) => (
                <tr key={b.line}>
                  <td className="mono">{b.line}</td>
                  <td className="mono">{b.table}</td>
                  <td>{b.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {broken.length > MAX_BROKEN_SHOWN && (
            <p className="muted small">Showing the first {MAX_BROKEN_SHOWN} of {broken.length}.</p>
          )}
        </>
      )}

      <div className="grid2 checkgrid">
        <div>
          <h3>2. Checks</h3>
          <Check c={r.missingLinks} />
          <Check c={r.negativeFloat} />
          <Check c={r.highFloat} />
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
          {r.openCount > 0 ? <FloatChart buckets={r.buckets} /> : <p className="small muted">Every activity is complete, so there's no float to chart.</p>}
        </div>
      </div>
    </section>
  )
}

function Check({ c }: { c: CheckResult }) {
  const extra = c.extra
  const more = c.count - c.examples.slice(0, 3).length
  return (
    <div className="check">
      <div className="check-head">
        <span className={`pill ${c.status}`}>{c.status}</span>
        <strong>{c.label}</strong>
        <span>
          {c.count} of {plural(c.total, 'open activity', 'open activities')}
        </span>
      </div>
      <div className="muted small">{c.detail}</div>
      {c.examples.length > 0 && (
        <ul className="examples small">
          {c.examples.slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}
          {more > 0 && <li className="muted">and {more} more</li>}
        </ul>
      )}
      {extra && (
        <div className={`small ${extra.count ? 'bad-text' : 'muted'}`}>
          {extra.count ? `Plus ${extra.count} ${extra.label}:` : `No links point to activities that aren't in the file.`}
        </div>
      )}
      {extra && extra.count > 0 && (
        <ul className="examples small">
          {extra.examples.slice(0, 3).map((x, i) => <li key={i}>{x}</li>)}
          {extra.count > 3 && <li className="muted">and {extra.count - 3} more</li>}
        </ul>
      )}
    </div>
  )
}
