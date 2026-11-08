import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { decodeXer, parseXer, XerFormatError } from '../src/lib/xer.ts'
import { loadXer, sameProjectOnly } from '../src/lib/load.ts'
import type { Loaded } from '../src/lib/load.ts'
import { DAY_MS } from '../src/lib/schedule.ts'
import type { Activity } from '../src/lib/schedule.ts'
import { CircularLogicError, runCpm, scheduleFloat } from '../src/lib/cpm.ts'
import { analyse } from '../src/lib/metrics.ts'
import { buildSummary, verifySummary } from '../src/lib/summary.ts'
import { brokenRowsSample, circularSample, largeSchedule, midriseUpdates } from '../src/lib/generate.ts'
import { floatBuckets, runChecks } from '../src/lib/checks.ts'
import { checkFile, checkFiles } from '../src/lib/checkfile.ts'
import type { FileCheck } from '../src/lib/checkfile.ts'

const midrise = () => midriseUpdates().map((x, i) => loadXer(x, `update-${i + 1}.xer`).schedule)

describe('parser', () => {
  it('rejects files that are not P6 exports', () => {
    expect(() => parseXer('hello,world\n1,2')).toThrow(XerFormatError)
    expect(() => parseXer('hello,world')).toThrow(/ERMHDR/)
  })

  it('rejects an export without activities', () => {
    expect(() => parseXer('ERMHDR\t19.12\n%T\tPROJECT\n%F\tproj_id\n%R\t1\n%E')).toThrow(/TASK/)
  })

  it('reads the sample updates', () => {
    const [first] = midrise()
    expect(first.activities.length).toBeGreaterThan(60)
    expect(first.relationships.length).toBeGreaterThan(first.activities.length - 5)
  })

  it('keeps reading after a %E between tables', () => {
    const text = [
      'ERMHDR\t8.4\t2026-04-09',
      '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tlast_recalc_date', '%R\t1\tP\t2026-01-15 12:00', '%E',
      '%T\tTASK', '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttask_type\tstatus_code\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt',
      '%R\t10\t1\tA1\tFirst\tTT_Task\tTK_NotStart\t16\t16', '%R\t11\t1\tA2\tSecond\tTT_Task\tTK_NotStart\t8\t8', '%E',
      '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt', '%R\t1\t11\t10\tPR_FS\t0', '%E',
    ].join('\n')
    const loaded = loadXer(text, 'per-table-end.xer')
    expect(loaded.schedule.activities).toHaveLength(2)
    expect(loaded.schedule.relationships).toHaveLength(1)
  })

  it('loads a file without a PROJECT table and warns about bad links', () => {
    const text = [
      'ERMHDR\t20.12\t2026-05-24',
      '%T\tTASK', '%F\ttask_id\ttask_code\ttask_name\ttask_type\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\tact_start_date',
      '%R\t1\tX\tOne\tTT_Task\t40\t40\t', '%R\t2\tY\tTwo\tTT_Weird\t40\t40\t',
      '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
      '%R\t1\t2\t1\tPR_FS\tNotANumber', '%R\t2\t2\t999\tPR_FS\t0', '%E',
    ].join('\n')
    const loaded = loadXer(text, 'no-project.xer')
    expect(loaded.schedule.relationships).toHaveLength(1)
    const w = loaded.warnings.join(' ')
    expect(w).toMatch(/999/)
    expect(w).toMatch(/NotANumber/)
    expect(w).toMatch(/TT_Weird/)
    const a = analyse([loaded.schedule])
    expect(a.metrics[0].hasPlannedDates).toBe(false)
  })

  it('names the activities in a logic loop', () => {
    try {
      loadXer(circularSample(), 'broken.xer')
      throw new Error('expected a loop')
    } catch (e) {
      expect(e).toBeInstanceOf(CircularLogicError)
      expect((e as CircularLogicError).loop).toEqual(expect.arrayContaining(['A1200', 'A1210', 'A1220']))
    }
  })
})

describe('grouping', () => {
  const updates = () => midriseUpdates().map((x, i) => loadXer(x, `u${i}.xer`))
  const variant = (base: Loaded, name: string, change: (a: Activity) => Activity, projectName = base.schedule.projectName): Loaded => ({
    ...base,
    name,
    schedule: { ...base.schedule, projectName, activities: base.schedule.activities.map(change) },
  })

  it('keeps the three sample updates without extra warnings', () => {
    const files = updates()
    const g = sameProjectOnly(files)
    expect(g.dropped).toEqual([])
    expect(g.kept.map((k) => k.warnings)).toEqual(files.map((f) => f.warnings))
  })

  it('drops a file from a different project', () => {
    const other = loadXer(largeSchedule(200), 'other.xer')
    const g = sameProjectOnly([...updates(), other])
    expect(g.kept.map((k) => k.name)).toEqual(['u0.xer', 'u1.xer', 'u2.xer'])
    expect(g.dropped[0].name).toBe('other.xer')
    expect(g.dropped[0].reason).toMatch(/activity IDs/)
  })

  it('drops a different project that reuses the same activity IDs', () => {
    const [u0, , u2] = updates()
    const towerB = variant(u0, 'tower-b.xer', (a) => ({ ...a, name: `Tower B ${a.name}` }), 'TOWER-B')
    const g = sameProjectOnly([towerB, u2])
    expect(g.kept.map((k) => k.name)).toEqual(['u2.xer'])
    expect(g.dropped[0].reason).toMatch(/same ID numbering/)
    expect(g.dropped[0].reason).toMatch(/A1000 is "Tower B Notice to proceed" here and "Notice to proceed" there/)
  })

  it('drops a template copy whose recorded work is different', () => {
    const [u0, , u2] = updates()
    const shifted = variant(u0, 'template-copy.xer', (a) => (a.actualStart === null ? a : { ...a, actualStart: a.actualStart + 14 * DAY_MS }))
    const g = sameProjectOnly([shifted, u2])
    expect(g.dropped[0].reason).toMatch(/actual start dates/)
  })

  it('keeps an update saved under a new project ID, with a warning', () => {
    const [u0, , u2] = updates()
    const copy = variant(u0, 'copy.xer', (a) => a, 'MIDRISE-42-U01')
    const g = sameProjectOnly([copy, u2])
    expect(g.dropped).toEqual([])
    expect(g.kept[0].warnings[0]).toMatch(/project ID \(MIDRISE-42-U01\) differs/)
  })

  it('tolerates small renames and corrected dates', () => {
    const [u0, , u2] = updates()
    let renamed = 0
    const edited = variant(u0, 'edited.xer', (a) => (renamed++ < 3 ? { ...a, name: `${a.name.toUpperCase()}!` } : a))
    expect(sameProjectOnly([edited, u2]).dropped).toEqual([])
  })
})

describe('metrics', () => {
  const a = analyse(midrise())

  it('tracks finish movement between updates', () => {
    expect(a.metrics).toHaveLength(3)
    expect(a.metrics[0].finishVarianceDays).toBe(3)
    expect(a.comparisons[1]!.finishMovementDays).toBe(3)
    expect(a.comparisons[2]!.finishMovementDays).toBe(2)
  })

  it('flags the switchgear losing float', () => {
    const losers = a.comparisons[1]!.floatLosers.map((x) => x.activity.code)
    expect(losers).toContain('A1510')
    const last = a.metrics[2]
    const switchgear = a.schedules[2].activities.find((x) => x.code === 'A1510')!
    expect(last.float.get(switchgear.id)! / 8).toBeLessThanOrEqual(10)
  })

  it('agrees with the CPM engine on float', () => {
    const s = a.schedules[2]
    const cpm = runCpm(s.activities, s.relationships)
    for (const act of s.activities.filter((x) => x.status !== 'complete')) {
      expect(cpm.times.get(act.id)!.tf).toBe(act.totalFloatHours)
    }
  })

  it('runs the schedule checks', () => {
    const logic = a.metrics[2].checks.find((c) => c.key === 'logic')!
    expect(logic.examples.join(' ')).toContain('A1440')
    expect(a.metrics[2].checks.find((c) => c.key === 'constraints')!.count).toBe(1)
  })
})

describe('summary', () => {
  const a = analyse(midrise())
  const s = buildSummary(a.metrics[2], a.comparisons[2], a.metrics[1])

  it('only uses computed numbers', () => {
    expect(verifySummary(s.text, s.facts).unknown).toEqual([])
  })

  it('catches an invented number', () => {
    const edited = s.text.replace(/moved \d+ days/, 'moved 12 days')
    expect(verifySummary(edited, s.facts).unknown).toContain('12')
  })
})

describe('scale', () => {
  it('handles 10,000+ activities in well under a second per step', () => {
    const text = largeSchedule(10000)
    const t0 = performance.now()
    const loaded = loadXer(text, 'large.xer')
    const t1 = performance.now()
    const result = analyse([loaded.schedule])
    const t2 = performance.now()
    runCpm(loaded.schedule.activities, loaded.schedule.relationships)
    const t3 = performance.now()
    expect(loaded.schedule.activities.length).toBe(10000)
    expect(result.metrics[0].activityCount).toBe(10000)
    console.log(`parse ${Math.round(t1 - t0)} ms, analyse ${Math.round(t2 - t1)} ms, cpm ${Math.round(t3 - t2)} ms`)
    expect(t3 - t0).toBeLessThan(3000)
  })
})

const sampleText = (file: string) => {
  const buf = readFileSync(new URL(`../public/samples/${file}`, import.meta.url))
  return decodeXer(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}

const okCheck = (r: FileCheck) => {
  if (!r.ok) throw new Error(r.error)
  return r
}

describe('broken rows', () => {
  const text = [
    'ERMHDR\t19.12\t2026-04-09',
    '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tlast_recalc_date', '%R\t1\tP\t2026-04-01 08:00',
    '%T\tTASK',
    '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttask_type\tstatus_code\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt\ttotal_float_hr_cnt\tearly_start_date',
    '%R\t1\t1\tA1\tFirst\tTT_Task\tTK_NotStart\t16\t16\t0\t2026-04-02 08:00',
    '%R\t2\t1\tA2\tSecond\tTT_Task\tTK_NotStart\t8\t8\t0\t2026-04-03 08:00',
    '%R\t3\t1\tA3\tShort',
    '%R\t4\t1\tA4\tBad date\tTT_Task\tTK_NotStart\t8\t8\t0\t2026-13-01 08:00',
    '%R\t5\t1\tA5\tBad duration\tTT_Task\tTK_NotStart\tabc\t8\t0\t',
    '%R\t6\t1\tA6\tBad float\tTT_Task\tTK_NotStart\t8\t8\tlots\t',
    '%R\t\t1\tA7\tNo id\tTT_Task\tTK_NotStart\t8\t8\t0\t',
    '%R\t2\t1\tA8\tDuplicate id\tTT_Task\tTK_NotStart\t8\t8\t0\t',
    '%R\t9\t1\tA1\tDuplicate code\tTT_Task\tTK_NotStart\t8\t8\t0\t',
    '%R\t10\t1\t\tNo code\tTT_Task\tTK_NotStart\t8\t8\t0\t',
    '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
    '%R\t1\t2\t1\tPR_FS\t0',
    '%R\t2\t4\t1\tPR_XX\t0',
    '%R\t3\t5\t1\tPR_FS\t2d',
    '%R\t4\t6\t999\tPR_FS\t0',
    'stray text',
    '%E',
  ].join('\n')

  it('lists each broken row with its line number and reason', () => {
    const s = loadXer(text, 'broken.xer').schedule
    const byLine = Object.fromEntries(s.broken.map((b) => [b.line, `${b.table}: ${b.reason}`]))
    expect(Object.keys(byLine).map(Number)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 20, 21, 22, 23])
    expect(byLine[9]).toMatch(/^TASK: short row: 4 values for 10 fields/)
    expect(byLine[10]).toMatch(/early_start_date "2026-13-01 08:00" isn't a date/)
    expect(byLine[11]).toMatch(/target_drtn_hr_cnt "abc" isn't a number \(read as 0\)/)
    expect(byLine[12]).toMatch(/total_float_hr_cnt "lots" isn't a number \(read as blank\)/)
    expect(byLine[13]).toMatch(/blank task_id; row skipped/)
    expect(byLine[14]).toMatch(/duplicate task_id 2 \(first on line 8\); row skipped/)
    expect(byLine[15]).toMatch(/duplicate task_code A1 \(also on line 7\)/)
    expect(byLine[16]).toMatch(/blank task_code/)
    expect(byLine[20]).toMatch(/^TASKPRED: unknown pred_type "PR_XX"/)
    expect(byLine[21]).toMatch(/lag_hr_cnt "2d" isn't a number/)
    expect(byLine[22]).toMatch(/pred_task_id 999 isn't an activity in this file/)
    expect(byLine[23]).toMatch(/doesn't start with %T, %F, %R or %E/)
  })

  it('skips rows without a usable activity ID and keeps the rest', () => {
    const s = loadXer(text, 'broken.xer').schedule
    expect(s.activities.map((a) => a.code)).toEqual(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A1', ''])
    expect(s.activities.find((a) => a.code === 'A4')!.earlyStart).toBeNull()
    expect(s.relationships).toHaveLength(3)
  })

  it("doesn't flag a trailing tab in the field list, bare relationship codes or a clean export", () => {
    const trailing = [
      'ERMHDR\t19.12\t2026-04-09',
      '%T\tTASK', '%F\ttask_id\ttask_code\ttask_name\tremain_drtn_hr_cnt\t', '%R\t1\tA\tOne\t8', '%R\t2\tB\tTwo\t8\t',
      '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt', '%R\t1\t2\t1\tSS\t0',
    ].join('\n')
    const s = loadXer(trailing, 'trailing.xer').schedule
    expect(s.broken).toEqual([])
    expect(s.relationships[0].type).toBe('SS')
    for (const x of midriseUpdates()) expect(loadXer(x, 'midrise.xer').schedule.broken).toEqual([])
  })

  it('makes the generated sample trigger every reason without rejecting the file', () => {
    const r = okCheck(checkFile(brokenRowsSample(), 'generated.xer'))
    const reasons = r.loaded.schedule.broken.map((b) => b.reason).join('\n')
    for (const re of [/short row/, /isn't a date/, /target_drtn_hr_cnt .* isn't a number/, /total_float_hr_cnt .* isn't a number/, /blank task_id/,
      /duplicate task_id/, /duplicate task_code/, /unknown pred_type/, /lag_hr_cnt .* isn't a number/, /isn't an activity in this file/, /doesn't start with/]) {
      expect(reasons).toMatch(re)
    }
    expect(r.floatSource).toBe('P6')
    expect(r.missingLinks.extra!.count).toBe(1)
    expect(r.negativeFloat.count).toBe(3)
    expect(r.highFloat.count).toBe(2)
  })
})

describe('checks', () => {
  it('counts links to missing activities next to the missing-links check', () => {
    const r = okCheck(checkFile(sampleText('generated-broken-rows.xer'), 'g.xer'))
    expect(r.missingLinks.status).toBe('fail')
    expect(r.missingLinks.extra!.examples[0]).toMatch(/^line \d+: missing activity 999 → B1180$/)
    const s = r.loaded.schedule
    expect(analyse([s]).metrics[0].checks.find((c) => c.key === 'logic')!.extra!.count).toBe(1)
  })

  it('uses computed float when the file has no stored float', () => {
    const text = [
      'ERMHDR\t19.12\t2026-04-09',
      '%T\tPROJECT', '%F\tproj_id\tproj_short_name\tlast_recalc_date', '%R\t1\tP\t2026-04-01 08:00',
      '%T\tTASK', '%F\ttask_id\tproj_id\ttask_code\ttask_name\ttask_type\tstatus_code\ttarget_drtn_hr_cnt\tremain_drtn_hr_cnt',
      '%R\t1\t1\tS\tStart\tTT_Mile\tTK_NotStart\t0\t0',
      '%R\t2\t1\tL\tLong task\tTT_Task\tTK_NotStart\t400\t400',
      '%R\t3\t1\tB\tShort task\tTT_Task\tTK_NotStart\t8\t8',
      '%R\t4\t1\tF\tFinish\tTT_FinMile\tTK_NotStart\t0\t0',
      '%T\tTASKPRED', '%F\ttask_pred_id\ttask_id\tpred_task_id\tpred_type\tlag_hr_cnt',
      '%R\t1\t2\t1\tPR_FS\t0', '%R\t2\t3\t1\tPR_FS\t0', '%R\t3\t4\t2\tPR_FS\t0', '%R\t4\t4\t3\tPR_FS\t0',
    ].join('\n')
    const s = loadXer(text, 'no-float.xer').schedule
    const fl = scheduleFloat(s)
    expect(fl.source).toBe('computed')
    expect(fl.float.get('3')).toBe(392)
    const high = runChecks(s, fl).find((c) => c.key === 'highfloat')!
    expect(high.count).toBe(1)
    expect(high.examples[0]).toBe('B Short task (49 days float)')
    expect(high.detail).toMatch(/computed/)
    expect(runChecks(s).find((c) => c.key === 'highfloat')!.count).toBe(1)
    expect(floatBuckets(fl).map((b) => b.count)).toEqual([0, 3, 0, 0, 1])
  })

  it('keeps P6 stored float when the file has it', () => {
    const s = loadXer(sampleText('aspose-testXer.xer'), 'aspose.xer').schedule
    expect(scheduleFloat(s).source).toBe('P6')
    expect(runChecks(s).find((c) => c.key === 'negfloat')!.detail).toMatch(/P6 stored total float/)
  })
})

describe('check-files mode', () => {
  const files = () => [
    { name: 'aspose-testXer.xer', text: sampleText('aspose-testXer.xer') },
    { name: 'groupdocs-sample.xer', text: sampleText('groupdocs-sample.xer') },
  ]

  it('checks two unrelated files separately instead of dropping one', () => {
    const loaded = files().map((f) => loadXer(f.text, f.name))
    expect(sameProjectOnly(loaded).dropped).toHaveLength(1)
    const results = checkFiles(files())
    expect(results.map((r) => [r.name, r.ok])).toEqual([['aspose-testXer.xer', true], ['groupdocs-sample.xer', true]])
  })

  it('gives the expected results for the two public files', () => {
    const [aspose, groupdocs] = checkFiles(files()).map(okCheck)
    const summary = (r: ReturnType<typeof okCheck>) => ({
      broken: r.loaded.schedule.broken.length,
      missing: r.missingLinks.count,
      dangling: r.missingLinks.extra!.count,
      negative: r.negativeFloat.count,
      high: r.highFloat.count,
      source: r.floatSource,
      buckets: r.buckets.map((b) => b.count),
    })
    expect(summary(aspose)).toEqual({ broken: 0, missing: 4, dangling: 0, negative: 0, high: 5, source: 'P6', buckets: [0, 72, 3, 3, 5] })
    expect(summary(groupdocs)).toEqual({ broken: 0, missing: 70, dangling: 0, negative: 0, high: 0, source: 'P6', buckets: [0, 70, 0, 0, 0] })
  })

  it('keeps the chart consistent with the float checks', () => {
    for (const r of [...checkFiles(files()), checkFile(brokenRowsSample(), 'g.xer')].map(okCheck)) {
      expect(r.buckets[0].count).toBe(r.negativeFloat.count)
      expect(r.buckets[4].count).toBe(r.highFloat.count)
      expect(r.buckets.reduce((n, b) => n + b.count, 0)).toBe(r.openCount)
    }
  })

  it('reports a file it cannot read on its own card', () => {
    const results = checkFiles([{ name: 'notes.txt', text: 'hello' }, ...files()])
    expect(results[0]).toEqual({ name: 'notes.txt', ok: false, error: expect.stringMatching(/ERMHDR/) })
    expect(results.slice(1).every((r) => r.ok)).toBe(true)
  })
})
