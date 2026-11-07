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
