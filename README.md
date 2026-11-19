# Styrke

A gym diary and training planner. One codebase, built into:

- an **Android app** (`Styrke.apk`), and
- the same app as an **installable web page** for planning and insights on a bigger screen.

It works fully offline. Your data lives on your device and, if you turn it on, in a private cloud copy.

## What it does

- **Today**: log sets in a table (weight × reps, tick when done). Everything saves as you type. Last session's numbers are pre-filled, with a target for today (reps first, then load). Rest timer, blocks (supersets and circuits), cardio.
- **Plan**: tap days on a calendar to commit to them, up to three months ahead. Give a day a type (upper, lower, push, pull, a preset of yours, ...) or leave it open. The **automatic planner** plans all committed days together (weeks or months ahead) for the most muscle growth; targets count any 7 days in a row, not calendar weeks: weekly sets with diminishing returns (first sets count most), a ceiling per muscle per session, fresh muscles, legs kept fresh for planned runs, and a recovery cost for every set, all within your time per session. Choose what it puts first (muscle size, strength or power) and tune it with sliders: body focus, kind of exercises, blocks, recovery. Commit many days at once from a weekly pattern, or clear a whole month (you have to type the month's name).
- **Body**: a front/back figure coloured by the load on each muscle and joint right now, or in 24/48/72 hours. Log pain (0-10) on joints and tendons; the planner goes easy on, or avoids, what loads them.
- **Insights**: volume and **weight-adjusted volume**, heavy/moderate/light split, whole-body load, per-exercise progress, cardio, consistency, recent bests.
- **Presets**: save whole workouts ("Upper A", "Easy run", "Hip 3"), gym work, cardio or both. Put one or several on a planned day, or add them to the workout you are doing.
- **More**: exercise library (edit muscles, create your own), blocks, workout presets, settings, backup, sync and import.

How the numbers are calculated is explained in the app under *More > How the numbers work*, and in [`src/model.js`](src/model.js).

## Install on Android

1. On the phone, open **Releases** on this repository and download `Styrke.apk` from the newest one
   (direct link: https://github.com/gandys/styrke/releases/latest/download/Styrke.apk).
2. Open the file. Android asks once to allow installing from your browser; allow it.
3. Later versions install over the old one and keep your data.

Every push to `main` builds a new APK automatically (`.github/workflows/build.yml`).

### Web version

Turn on GitHub Pages once: *Settings > Pages > Source: GitHub Actions*. The workflow then publishes the app at
https://gandys.github.io/styrke/. In Chrome choose *Install app* / *Add to Home screen*.

## Keeping your data safe

| Layer | What | Where to set it up |
|---|---|---|
| Autosave | Every change is written to the device straight away, twice (localStorage and IndexedDB). Seven daily restore points. | automatic |
| Daily backup file (Android) | `Download/Styrke/styrke-backup-YYYY-MM-DD.json`, last 14 kept. Point Google Drive or any backup app at that folder if you like. | automatic, toggle in *More > Backup* |
| Cloud sync | One JSON file plus CSV copies in a **private GitHub repository of your own**, with full version history. Phone and laptop merge record by record. | *More > Backup, sync and import* |
| Manual | Save or share a backup file, or CSV spreadsheets, any time. | same page |

Cloud sync setup (once): create a private repository (for example `styrke-data`), create a fine-grained personal
access token limited to that repository with *Contents: read and write*, and paste owner, repository and token into the app.
The token stays on the device; it is never written to backups or synced.

## Import

*More > Backup, sync and import > Import a file* accepts:

- a workout log from Notion or Excel (`.xlsx` or `.csv`, one row per set, columns `Exercise`, `Date`, `Weight`, `Reps`, optional `Notes`, `ID`). Cardio rows with a note such as `Bici 50 min` become cardio entries. Importing the same file again does not duplicate anything.
- a Styrke backup (`.json`)
- a Styrke plan file, see [`docs/CLAUDE_SYNC.md`](docs/CLAUDE_SYNC.md) for the format Claude (or anything else) can write.

## Development

```
npm ci
npm test          # model, planner, importer and sync tests
npm run build     # dist/styrke.html (single file) and dist/web/ (installable web app)
```

- `src/model.js` hard sets, weight-adjusted volume, load that decays with rest
- `src/planner.js` the automatic planner
- `src/library.js` muscles, joints, built-in exercises
- `src/views/` the five screens
- `android/` a small WebView wrapper (`MainActivity.java`) with a bridge for backup files and sharing

### About the signing key

`android/styrke.keystore` is committed on purpose. Every build must be signed with the same key, otherwise Android refuses
to update the installed app and you would have to uninstall it, which deletes its data. The key only proves "same builder as
last time" for an app you install by hand; it protects nothing else. If you ever distribute the app to others, replace it with
a private key stored as a GitHub secret.
