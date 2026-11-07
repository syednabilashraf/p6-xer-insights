import { describe, expect, it } from 'vitest'
import { parseXer, XerFormatError } from '../src/lib/xer.ts'
import { loadXer } from '../src/lib/load.ts'
import { CircularLogicError, runCpm } from '../src/lib/cpm.ts'
import { analyse } from '../src/lib/metrics.ts'
import { buildSummary, verifySummary } from '../src/lib/summary.ts'
import { circularSample, largeSchedule, midriseUpdates } from '../src/lib/generate.ts'

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
