# PlanMerge Demo Capture Guide

This guide records the recommended evidence flow for screenshots and a short demo video.

## Recommended Flow

1. Show the project brief so viewers see the planning criteria first.
2. Seed a small workspace with ChatGPT, Claude, and Gemini-style drafts.
3. Run PlanMerge analysis.
4. Capture the merge result with source-backed decisions.
5. Capture a decision-trace panel.
6. Capture Analysis Inspector: Quality Gate, Decision Blocks, and Validation.
7. Save the analysis JSON, screenshots, summary, and `.webm` video under `docs/demo/output/`.

## No-Credit Local Capture

```powershell
npm run demo:capture -- --local
```

Use this for rehearsal, retakes, and UI polish. It does not spend GMS credits.

## Real GMS Capture

Set the key in the shell without writing it into files or commands:

```powershell
$env:GMS_API_KEY = "<set locally>"
npm run demo:capture -- --gms --model gpt-5.5 --stop-remain 50000
```

The capture script checks key-info before the run. If remaining credit is at or below `--stop-remain`, it stops before analysis.

## Replay A Saved GMS Result

Use this after a real GMS run when you need cleaner screenshots or a retake without spending more credit:

```powershell
npm run demo:capture -- --analysis-file docs/demo/output/planmerge-demo-analysis-<timestamp>.json
```

The app still shows the saved result as `GMS` if the captured JSON has `source: "gms"`.

For a slower presentation video, add `--presentation`. This inserts deliberate pauses, scrolls through the inspector, and captures the export menu:

```powershell
npm run demo:capture -- --analysis-file docs/demo/output/planmerge-demo-analysis-<timestamp>.json --presentation
```

Tune the pace if needed:

```powershell
npm run demo:capture -- --analysis-file docs/demo/output/planmerge-demo-analysis-<timestamp>.json --presentation --pace-ms 3200
```

## Output

Each run creates timestamped artifacts:

- `planmerge-demo-summary-*.md`
- `planmerge-demo-analysis-*.json`
- `planmerge-demo-*.webm`
- `screenshots-*/00-project-brief.png`
- `screenshots-*/01-drafts-ready.png`
- `screenshots-*/02-merge-result.png`
- `screenshots-*/03-decision-trace.png`
- `screenshots-*/04-quality-gate.png`
- `screenshots-*/05-decision-blocks.png`
- `screenshots-*/06-validation.png`
- `screenshots-*/07-export-actions.png` when `--presentation` is used

The output folder is intentionally ignored by Git because videos and screenshots can grow quickly.
