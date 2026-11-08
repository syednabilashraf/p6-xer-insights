import { loadXer } from './load.ts'
import type { Loaded } from './load.ts'
import type { CheckResult, FloatBucket } from './checks.ts'
import { floatBuckets, runChecks } from './checks.ts'
import type { FloatSource } from './cpm.ts'
import { scheduleFloat } from './cpm.ts'

export const MAX_CHECK_FILES = 10

export type FileCheck =
  | { name: string; ok: false; error: string }
  | {
      name: string
      ok: true
      loaded: Loaded
      floatSource: FloatSource
      missingStoredFloat: number
      openCount: number
      missingLinks: CheckResult
      negativeFloat: CheckResult
      highFloat: CheckResult
      buckets: FloatBucket[]
      ms: number
    }

export function checkFile(text: string, name: string): FileCheck {
  const t0 = performance.now()
  try {
    const loaded = loadXer(text, name)
    const fl = scheduleFloat(loaded.schedule)
    const checks = runChecks(loaded.schedule, fl)
    const pick = (key: string) => checks.find((c) => c.key === key)!
    return {
      name,
      ok: true,
      loaded,
      floatSource: fl.source,
      missingStoredFloat: fl.missingStored,
      openCount: fl.float.size,
      missingLinks: pick('logic'),
      negativeFloat: pick('negfloat'),
      highFloat: pick('highfloat'),
      buckets: floatBuckets(fl),
      ms: performance.now() - t0,
    }
  } catch (e) {
    return { name, ok: false, error: e instanceof Error ? e.message : String(e) }
  }
}

export function checkFiles(files: { name: string; text: string }[]): FileCheck[] {
  return files.map((f, i) =>
    i < MAX_CHECK_FILES
      ? checkFile(f.text, f.name)
      : { name: f.name, ok: false, error: `Only ${MAX_CHECK_FILES} files can be checked at once, so this file was skipped` },
  )
}
