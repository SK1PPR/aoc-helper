# Advent of Code for VS Code

Solve [Advent of Code](https://adventofcode.com) without leaving the editor: read puzzles, get your inputs, run your solution on the examples and on your input, submit answers, and follow leaderboards. It works the same way the Competitive Programming Helper extension does for Codeforces.

## Features

- **Puzzles sidebar.** Every year from 2015 on, with your stars per day and a countdown on days that haven't unlocked yet. 2025 and later have 12 days.
- **Puzzle view.** The puzzle rendered in a themed webview, with buttons to set up the day, open the input, run, and submit. Hover any example block and click **Save as sample** to store it as `sampleN.txt`.
- **Set Up Day.** One click (sidebar, puzzle view or command palette) creates the day folder, a solution file from your template, `input.txt` and `sample.txt`, then opens the solution next to the puzzle.
- **Inputs and samples on disk.** When you open a puzzle it downloads `input.txt` (once, then cached) and puts the first example from part one in `sample.txt`.
- **Solution templates.** For Python, JavaScript, TypeScript, C++, Rust and Go, or your own template file.
- **Run on samples or input.** Runs from the editor title bar, the sidebar or the puzzle view. Output streams to the *Advent of Code* output channel, along with the exit code and the run time.
- **Submit.** After a run on your input, the extension reads the answers from the output and offers a one-click **Submit Part N**. If a submission is wrong, it remembers the answer so it can't be sent again by accident. You also see the "too high/too low" and rate-limit messages.
- **Leaderboards.**
  - Private leaderboards: an overall star grid like the one on the website, plus per-day results with solve times and local points.
  - The global leaderboard for 2015–2024, overall and per day. AoC dropped the global leaderboard in 2025.
- **Unlock countdown.** A status bar countdown in the last 24 hours before a puzzle opens, and a notification when it does.

## Getting started

1. `npm install && npm run compile`, then press **F5** in this folder to start an Extension Development Host. To install it permanently, run `npm run package` and then *Extensions → … → Install from VSIX*.
2. Open the folder where you keep your solutions.
3. Click the **Advent of Code** icon in the activity bar, then **Sign In**. Copy the value of your `session` cookie: log in on adventofcode.com (the input box has a button that opens it), open DevTools → Application (Chrome) or Storage (Firefox) → Cookies → `session`. The extension watches the clipboard while the input box is open and signs in as soon as you copy it; if the cookie is already on the clipboard when you click Sign In, it is used immediately. The cookie is kept in VS Code's secret storage. If no cookie is stored, the extension uses the `AOC_SESSION` environment variable.
4. Set `aoc.contact` to your email or repo URL. AoC asks automated tools to identify themselves in the User-Agent.

## Layout

With the default `aoc.folderTemplate` (`aoc/${year}/day${dd}`):

```
aoc/2025/day01/
  solution.py     # created from the template
  input.txt       # your personal input (downloaded once)
  sample.txt      # first example from the puzzle
  sample2.txt     # any more you save from the puzzle view
```

While any file in a day folder is open, the editor title bar has **Run on Samples**, **Run on Input** and **Submit** buttons.

**Don't commit `input.txt`.** AoC asks people not to share their inputs. Add `aoc/**/input.txt` to your `.gitignore`.

## Answers

The built-in templates print `Part 1: <answer>` and `Part 2: <answer>`. After a run on your input, the extension uses those lines. If they're missing, it takes the last two non-empty lines of output. You always see the answer before anything is sent.

## Settings

| Setting | Default | |
| --- | --- | --- |
| `aoc.contact` | `""` | Contact info for the User-Agent |
| `aoc.folderTemplate` | `aoc/${year}/day${dd}` | Where each day's files go (`${year}`, `${day}`, `${dd}`) |
| `aoc.language` | `python` | Language for new solutions (key of `aoc.languages`) |
| `aoc.languages` | python, javascript, typescript, cpp, rust, go | `{ extension, run, template? }`; `run` gets `${file}`, `${input}`, `${dir}`, `${year}`, `${day}`, and the input is also piped to stdin |
| `aoc.autoFetchInput` | `true` | Download the input and sample when a puzzle opens |
| `aoc.runTimeoutSeconds` | `60` | Kill long-running solutions |
| `aoc.privateLeaderboards` | `[]` | Leaderboard IDs or join codes |
| `aoc.showCountdown` | `true` | Status bar unlock countdown |

For example, to add Kotlin with a template of your own:

```jsonc
"aoc.language": "kotlin",
"aoc.languages": {
  "kotlin": {
    "extension": "kts",
    "run": "kotlinc -script \"${file}\" \"${input}\"",
    "template": "templates/solution.kts"
  }
}
```

## Being a good citizen

The extension follows AoC's [automation guidelines](https://www.reddit.com/r/adventofcode/wiki/faqs/automation):

- It sends at most one request per second.
- Inputs are downloaded once and never fetched again.
- Leaderboards are cached for 15 minutes, even when you click refresh.
- Finished puzzles are cached for good.
- The User-Agent includes your `aoc.contact`.

## Releasing

Pushing to `main` runs `.github/workflows/release.yml`. It builds the `.vsix`, and if the `version` in `package.json` hasn't been published yet, it publishes to the VS Code Marketplace and to Open VSX (VSCodium, Cursor and other editors that use it), then creates a GitHub release `vX.Y.Z` with the `.vsix` attached. Pushes that don't change the version only build. To release, bump the version (`npm version patch --no-git-tag-version`) and push.

Publishing uses [trusted publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing) (OIDC), so no access tokens are stored in the repository. One-time setup:

- **VS Code Marketplace:** on your publisher's management page, open **Trusted Publishing** and add a policy for this repository with the workflow file `release.yml` and no environment.
- **Open VSX:** create the namespace for the publisher, then add a trusted publisher for this repository and `release.yml`.
- **GitHub:** set the repository variable `PUBLISH` to `true` (Settings → Secrets and variables → Actions → Variables). Until then the workflow only builds. Set `PUBLISH_OPEN_VSX` to `true` as well once the Open VSX namespace is ready; until then that step is skipped. Re-running the workflow afterwards publishes the current version there too.
