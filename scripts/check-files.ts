import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { decodeXer } from '../src/lib/xer.ts'
import { analyse } from '../src/lib/metrics.ts'
import { buildSummary, fmtDate, verifySummary } from '../src/lib/summary.ts'
import { brokenRowText, checkFile } from '../src/lib/checkfile.ts'

const MAX_BROKEN_PRINTED = 20

for (const file of process.argv.slice(2)) {
  const name = basename(file)
  const buf = readFileSync(file)
  const r = checkFile(decodeXer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)), name)
  if (!r.ok) {
    console.log(`FAIL ${name}: ${r.error}`)
    continue
  }
  const s = r.loaded.schedule
  const m = analyse([s]).metrics[0]
  const summary = buildSummary(m, null, null)
  const v = verifySummary(summary.text, summary.facts)
  console.log(`OK   ${name}: ${s.activities.length} activities, ${s.relationships.length} links, data date ${fmtDate(m.dataDate)}, finish ${fmtDate(m.forecastFinish)} (planned ${m.plannedFinish ? fmtDate(m.plannedFinish) : 'n/a'}), critical ${m.criticalCount}, ${m.pctActual}% done, warnings ${r.loaded.warnings.length}, summary unknown=[${v.unknown.join(',')}]`)
  console.log(`     broken rows: ${s.broken.length}`)
  for (const b of s.broken.slice(0, MAX_BROKEN_PRINTED)) console.log(`       ${brokenRowText(b)}`)
  if (s.broken.length > MAX_BROKEN_PRINTED) console.log(`       and ${s.broken.length - MAX_BROKEN_PRINTED} more`)
  for (const c of [r.missingLinks, r.negativeFloat, r.highFloat]) {
    const extra = c.extra?.count ? ` + ${c.extra.count} ${c.extra.label}` : ''
    console.log(`     ${c.status.toUpperCase().padEnd(4)} ${c.label}: ${c.count} of ${c.total} open activities${extra}`)
  }
  console.log(`     float from ${r.floatSource}: ${r.buckets.map((b) => `${b.label}: ${b.count}`).join(', ')}`)
}
