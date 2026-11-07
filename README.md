# P6 schedule update review

**Live demo: https://p6-xer-insights.vercel.app**

A small working sample of a schedule update review tool for Primavera P6 `.xer` exports. Upload one to three monthly updates and it:

- reads the `.xer` file with plain code (no LLM) and rejects broken files with a clear reason, such as a wrong format or circular logic, naming the activities in the loop
- finds the critical and near-critical activities and tracks float between updates
- shows planned vs actual progress (S-curve), the forecast finish at each update, and planned starts and finishes achieved
- runs schedule quality checks: missing logic, leads, lags, relationship types, hard constraints, negative and high float, long durations and invalid dates
- writes an executive summary from the computed numbers only, then checks every number and date in it against those numbers

Everything runs in the browser, so the files never leave the user's computer.

![Screenshot](docs/screenshot.png)

## How it works

| File | What it does |
|---|---|
| `src/lib/xer.ts` | Parses the `%T` / `%F` / `%R` table format; rejects files that aren't P6 exports |
| `src/lib/schedule.ts` | Maps `PROJECT`, `PROJWBS`, `TASK` and `TASKPRED` rows to activities and relationships |
| `src/lib/load.ts` | Validates a file, including loop detection, before anything is calculated |
| `src/lib/cpm.ts` | Forward and backward pass with FS, SS, FF and SF links and lags |
| `src/lib/checks.ts` | Schedule quality checks |
| `src/lib/metrics.ts` | Forecast finish, float, critical path, S-curve, starts and finishes achieved, update-to-update comparison |
| `src/lib/summary.ts` | Summary template, number checker and the prompt contract for an AI-written version |
| `src/lib/generate.ts` | Generates the sample project and large test schedules |

## Speed

Measured on a MacBook with Node 24 (`npm run samples`):

| Activities | Links | Read and validate | Metrics | Full critical-path calculation |
|---|---|---|---|---|
| 10,000 | 13,681 | 42 ms | 11 ms | 16 ms |
| 50,000 | 68,319 | 204 ms | 44 ms | 93 ms |

The demo page has buttons that run the same test in the browser.

## Run it

```bash
npm install
npm run dev      # local app
npm test         # parser, loop detection, metrics, summary check, 10,000-activity test
npm run samples  # regenerate public/samples and print timings
```

## Notes

- The sample schedules are generated (a 42-unit midrise with three monthly updates and a switchgear delay), not real project data.
- When an export includes P6 total float, the metrics use it. Otherwise the built-in CPM computes float. The CPM works in 8-hour days and ignores calendars, so it's a cross-check rather than a replacement for P6's scheduler.
- Planned dates come from each activity's target dates.
