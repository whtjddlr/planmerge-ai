# PlanMerge GMS Evaluation Harness

Use this harness when you want to spend GMS credits on evidence that improves the PlanMerge demo:

- real GMS 2-step analysis runs
- schema validation
- rule-based quality scorecards
- optional GMS judge reviews
- before/after credit snapshots

## Setup

Put the key in your shell or local env file. Do not commit it.

```powershell
$env:GMS_API_KEY = "..."
```

Optional model override:

```powershell
$env:GMS_DEFAULT_MODEL = "gpt-4.1"
```

## Dry Run

```bash
npm run harness:gms -- --dry-run --case mvp-conflict --judge
```

This prints the selected cases and planned GMS calls without spending credit.

## Small Verification Run

```bash
npm run harness:gms -- --case mvp-conflict --concurrency 1 --delay-ms 250 --stop-remain 50000
```

Expected behavior:

- 4 draft normalize calls
- 1 merge call
- a JSON report in `reports/gms-eval/`
- credit before/after printed in the terminal

## Useful Runs

Pro judge-only review of an existing successful report:

```bash
npm run harness:gms -- --judge-report reports/gms-eval/planmerge-gms-eval-2026-07-07T08-40-17-836Z.json --model gpt-5.5-pro --stop-remain 80000
```

Use this mode for expensive "pro" models. It reuses an existing PlanMerge result and spends only on evaluator agents, avoiding the costly normalize/merge path.

Broad portfolio scorecard:

```bash
npm run harness:gms -- --case sample-baseline,full-sections --judge --repeat 3 --stop-remain 100000
```

Multi-company source coverage:

```bash
npm run harness:gms -- --case multi-company-mvp,multi-company-full-plans --judge --repeat 3 --stop-remain 100000
```

Conflict and safety regression:

```bash
npm run harness:gms -- --case mvp-conflict,prompt-injection,thin-evidence --judge --repeat 5 --stop-remain 80000
```

Higher spend batch:

```bash
npm run harness:gms -- --case sample-baseline,multi-company-mvp,multi-company-full-plans,mvp-conflict,prompt-injection,thin-evidence,full-sections --judge --repeat 10 --concurrency 2 --delay-ms 150 --stop-remain 80000
```

## Available Cases

```bash
npm run harness:gms -- --list
```

Current cases:

- `sample-baseline`: repository sample workspace with 13 drafts
- `mvp-conflict`: focused MVP scope conflict
- `prompt-injection`: untrusted draft instruction injection
- `thin-evidence`: thin inputs that should remain review-gated
- `full-sections`: 12-section repeatable planning set
- `multi-company-mvp`: different people use ChatGPT, Claude, Gemini, Cursor, and Other for one MVP decision
- `multi-company-full-plans`: full overlapping drafts from different AI-company sources

## Spending Guidance

For the remaining hackathon credit, keep at least 50k-100k as demo-day buffer.
Spend the rest on repeated scorecard runs and judge runs, then summarize the reports in the README or presentation.

## Pro Model Lessons

- Do not run `gpt-5.5-pro` as the full normalizer/merger by default. In testing, it spent heavily and failed at merge on output limit or timeout.
- Prefer `gpt-5.5` or another stable model for generation, then use `gpt-5.5-pro` with `--judge-report` for evaluator-only review.
- Pro judges must stay grounded in the case payload and PlanMerge result. If a judge invents a new product domain, treat that as evaluator hallucination and tighten the judge prompt.
- Focused decision cases such as `mvp-conflict` or `multi-company-mvp` should be judged mainly on conflict preservation, source traceability, selected/rejected options, and human-review flags. Full section coverage matters more for full-document cases.
- Evaluation fixtures must use PlanMerge project settings when the drafts discuss PlanMerge. A previous multi-company case accidentally inherited the sample action-item SaaS project goal; Pro correctly surfaced that context mismatch.
- Conflict metadata is now a quality gate: a non-`none` `conflictLevel` requires at least one `conflict` option, and conflict options require `needsHumanReview: true`.

## Credit-Saver Findings

Latest no-extra-credit review, based on existing reports:

- Keep the remaining `50,899` credits as a demo-day buffer unless a new run is tied to a concrete fix.
- `gpt-5.5` corrected `multi-company-mvp` run: score `79`, level `review`, schema valid, 5/5 drafts covered, 13 normalized ideas, 5 decision blocks, 6/12 final sections, 2 conflicts, 7,668 credits used.
- `claude-opus-4-8` run: score `79`, level `review`, schema valid, 14 ideas, 7 decision blocks, 7/12 final sections, 3 conflicts, 5,989 credits used.
- `gemini-3.5-flash` run after JSON extraction fix: score `68`, level `review`, schema valid, 10 ideas, 4 decision blocks, 5/12 final sections, 1 conflict, 951 credits used.
- Repeated evidence says the next quality gain is not another broad model sweep. It is better section coverage for focused cases and stricter conflict metadata.
- The latest corrected run still surfaced an external API risk block with `conflictLevel=medium` but no conflict option and no human-review flag. That pattern is now covered by validation and quality regression tests.

Recommended next paid run:

```bash
npm run harness:gms -- --case multi-company-mvp --judge --model gpt-5.5 --stop-remain 50000
```

Run this only after a local quality pass. If it stays above `80` with no validation repair and no inconsistent conflict metadata, spend one pro judge-only review:

```bash
npm run harness:gms -- --judge-report <latest-report.json> --model gpt-5.5-pro --stop-remain 50000
```
