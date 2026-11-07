import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { decodeXer } from '../src/lib/xer.ts'
import { loadXer } from '../src/lib/load.ts'
import { analyse } from '../src/lib/metrics.ts'
import { buildSummary, fmtDate, verifySummary } from '../src/lib/summary.ts'

for (const file of process.argv.slice(2)) {
  const name = basename(file)
  try {
    const buf = readFileSync(file)
    const text = decodeXer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
    const loaded = loadXer(text, name)
    const a = analyse([loaded.schedule])
    const m = a.metrics[0]
    const s = buildSummary(m, null, null)
    const v = verifySummary(s.text, s.facts)
    console.log(`OK   ${name}: ${loaded.schedule.activities.length} activities, ${loaded.schedule.relationships.length} links, data date ${fmtDate(m.dataDate)}, finish ${fmtDate(m.forecastFinish)} (planned ${m.plannedFinish ? fmtDate(m.plannedFinish) : 'n/a'}), critical ${m.criticalCount}, float from ${m.floatSource}, ${m.pctActual}% done, warnings ${loaded.warnings.length}, summary unknown=[${v.unknown.join(',')}]`)
  } catch (e) {
    console.log(`FAIL ${name}: ${e instanceof Error ? `${e.constructor.name}: ${e.message}` : String(e)}`)
  }
}
