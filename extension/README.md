# CodeTrackr for VS Code

**Automatic coding-time tracking for you and your friends.** Install it once, sign in once, and
CodeTrackr records how long you code, in which languages and projects, your commits, and how often
your commands and builds fail. Compare it all with friends on group boards and the leaderboard at
the [CodeTrackr dashboard](https://code-trackr-frontend.vercel.app).

## Getting started (1 minute)

1. **Install** this extension.
2. Open the Command Palette (`Ctrl+Shift+P`, or `Cmd+Shift+P` on Mac) and run
   **CodeTrackr: Sign In**.
3. A short code such as `WXYZ-2345` is copied for you and the dashboard opens in your browser.
   Sign in with Google and click **Approve**.
4. Done. VS Code connects by itself and tracking starts. No key to copy or paste.

Each computer you sign in from gets its own key. You can see and disconnect them on the dashboard
under **Profile → Connected devices**; a lost laptop can be cut off without affecting the others.
Device keys expire after one year — just run **Sign In** again.

## What's new in 2.5.0

- **Sign In** — connect with a short code instead of copying an API key.
- **Nothing lost offline** — every upload is saved before it is sent and retried oldest first,
  even after VS Code restarts. Retries are counted once on the server.
- **Key in your OS keychain** — the key is kept in VS Code's SecretStorage instead of
  `settings.json`. A key from an older version is moved there automatically.
- **Correct times for held work** — time recorded while offline is filed under the project,
  language and time it actually happened.

Full history: [CHANGELOG](CHANGELOG.md).

## Commands

| Command | What it does |
|---|---|
| **CodeTrackr: Sign In** | Connect this VS Code to your account (recommended) |
| CodeTrackr: Show Connection Info | Shows whether you are connected and to which server |
| CodeTrackr: Show Statistics | Shows what has been recorded in this session |
| CodeTrackr: Show Event Logs | Opens the extension's log output |
| CodeTrackr: Flush Now | Sends the current interval immediately |
| CodeTrackr: Start / Stop Tracking | Pause and resume tracking |
| CodeTrackr: Setup API Key | Older way to connect: paste a key from the dashboard's Profile page |

## What is tracked, and what is not

**Sent** (a small summary after about 2 minutes of real activity):
- active coding time, the language, and the project (workspace) name;
- edit counts (lines added and removed, saves), time reading vs writing, window-focus time;
- commit counts; debug sessions;
- terminal commands by type (build, test, git, …) and whether they failed. A command that fails
  repeatedly is sent with anything that looks like a password, token or key replaced by `***`,
  cut to 120 characters.

**Never sent:** file contents, diffs, commit messages, full file paths, keystrokes.

All traffic is HTTPS. Your key is stored in your operating system's keychain.

## Settings

You normally don't need to change anything.

| Setting | Default | Meaning |
|---|---|---|
| `codetrackr.apiBase` | `https://codetrackr-backend-uckp.onrender.com` | Server address. Change only if you self-host. |
| `codetrackr.minFlushMinutes` | `2` | Minutes of activity before a summary is sent |
| `codetrackr.flushIntervalSeconds` | `30` | How often the timer checks |
| `codetrackr.debug` | `false` | Extra logging in the output panel |
| `codetrackr.apiKey` | — | Deprecated. Use **Sign In**; old values are moved to the keychain. |

## Troubleshooting

- **Nothing shows on the dashboard.** Run **Show Connection Info**. If it says you are not
  connected, run **Sign In**. Summaries are sent after about 2 minutes of activity; **Flush Now**
  sends the current one immediately.
- **First upload of the day is slow.** The free server sleeps when idle and takes ~20 seconds to
  wake. Nothing is lost: the upload waits in the queue and retries.
- **The extension says your key was rejected.** Device keys expire after a year, or the device was
  disconnected on the Profile page. Run **Sign In** again.

## About

Built by Pratik Jambhule, Kartik Kharat and Soham Budhewar.
Source: [github.com/PratikJambhule/CodeTrackr](https://github.com/PratikJambhule/CodeTrackr) ·
License: MIT
