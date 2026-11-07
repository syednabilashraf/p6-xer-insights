import { mkdirSync, writeFileSync } from 'node:fs'
import { circularSample, largeSchedule, midriseUpdates } from '../src/lib/generate.ts'
import { loadXer } from '../src/lib/load.ts'
import { analyse } from '../src/lib/metrics.ts'
import { runCpm } from '../src/lib/cpm.ts'

mkdirSync('public/samples', { recursive: true })
const names = ['midrise-update-1-2026-04-01.xer', 'midrise-update-2-2026-05-01.xer', 'midrise-update-3-2026-05-31.xer']
midriseUpdates().forEach((x, i) => writeFileSync(`public/samples/${names[i]}`, x))
writeFileSync('public/samples/broken-circular-logic.xer', circularSample())

for (const n of [10000, 50000]) {
  const text = largeSchedule(n)
  const t0 = performance.now()
  const loaded = loadXer(text, 'large.xer')
  const t1 = performance.now()
  analyse([loaded.schedule])
  const t2 = performance.now()
  runCpm(loaded.schedule.activities, loaded.schedule.relationships)
  const t3 = performance.now()
  console.log(`${n} activities, ${loaded.schedule.relationships.length} links: parse+validate ${Math.round(t1 - t0)} ms, metrics ${Math.round(t2 - t1)} ms, full CPM ${Math.round(t3 - t2)} ms`)
}
