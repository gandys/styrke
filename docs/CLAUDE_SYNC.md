# Sending planned sessions to Styrke

Styrke can take planned sessions from outside: a marathon plan, a physio programme, anything.
This file describes the format so that Claude (or any tool) can produce it.

## The plan file

```json
{
  "styrke": "plan",
  "source": "marathon",
  "replace": { "from": "2026-11-16", "to": "2026-12-06" },
  "sessions": [
    { "date": "2026-11-17", "kind": "run", "name": "Easy run", "minutes": 35, "effort": 3, "note": "Talk-test pace, 1% incline" },
    { "date": "2026-11-19", "kind": "run", "name": "Easy run + strides", "minutes": 30, "km": 4.5, "effort": 4 },
    { "date": "2026-11-21", "kind": "run", "name": "Long run", "minutes": 60, "effort": 4 },
    { "date": "2026-11-17", "kind": "strength", "type": "lower",
      "items": [ { "exercise": "Leg Press", "sets": 3, "reps": "8-12" }, { "exercise": "Calf Raise", "sets": 3, "reps": "10-15" } ] },
    { "date": "2026-11-18", "kind": "strength", "type": "pull" },
    { "date": "2026-11-22", "kind": "rest" }
  ]
}
```

| Field | Meaning |
|---|---|
| `styrke` | Must be `"plan"`. |
| `source` | A short label for where the plan comes from. Shown as a tag on each imported item. |
| `replace` | Optional. Before importing, removes earlier imported items **from the same source** in this date range. Use it when re-sending an updated plan so sessions are not doubled. Items the user added by hand are never touched. |
| `sessions[].date` | `YYYY-MM-DD`. The day becomes a committed day in the calendar. |
| `sessions[].kind` | `run`, `treadmill`, `bike`, `hike`, `swim`, `walk`, `ski`, `row`, `climb`, `cardio`, `strength` or `rest`. |
| cardio fields | `name` (label), `minutes`, `km`, `effort` (1-10, default 4), `note`. For other activities add `"activity": "Name"`; it is matched to the exercise library or created. |
| strength fields | `type`: `auto`, `upper`, `lower`, `full`, `push`, `pull`, `legs`, `arms`, `core` or `custom`. `preset`: name of one of the user's presets. `items`: fixed exercises (`exercise` name, `sets`, `reps` as `"8-12"` or a number, `note`). Without `items`, the app's planner fills the day according to `type`. |

Exercise names are matched against the user's exercises and the built-in library (case and accents ignored). Unknown names are created as new exercises without muscles, flagged for the user to complete.

Planned cardio counts toward the load forecast: a planned run tomorrow shows on the body map and makes the planner go lighter on legs around it.

## Three ways to get it into the app

1. **Paste**: *More > Backup, sync and import > Planned sessions*, paste the JSON, press *Import plan*.
2. **File**: save it as `something.json` and use *Import a file*.
3. **Automatic, with GitHub sync on**: commit the file to the `inbox/` folder of the user's data repository
   (for example `inbox/marathon-2026-11-16.json`). On the next sync the app imports it and deletes the file.
   A Claude session with access to that repository can do this directly.

When the app runs as a Claude artifact, Claude can instead write the same object as a document in the artifact's
database, collection `inbox` (any document id). The app imports it on the next sync and deletes it.

## Reading the user's training data

With GitHub sync on, the data repository holds:

- `styrke-data.json` everything (sessions, plan, exercises, settings, pain log)
- `export/sets.csv` one row per set: date, exercise, weight, reps, effective load, volume, weight-adjusted volume, hard-set value, zone, estimated 1RM
- `export/cardio.csv`, `export/plan.csv`, `export/pain.csv`

The CSV copies are refreshed at most once a day.

## A prompt that works

> Export the next three weeks of my plan as a Styrke plan file (format in docs/CLAUDE_SYNC.md of the Styrke repository).
> Use source "marathon" and a replace range covering those three weeks. Runs as kind "run" with minutes and effort;
> gym days as kind "strength" with the type only, so the app's planner chooses the exercises.
