# CodeTrackr for VS Code

**Automatic coding-time tracking for you and your friends.** Install it once, sign in once, and
CodeTrackr records how long you really code (writing, reading and running, file by file), in which
languages and projects, your commits, and how often your commands and builds fail. Compare it all with
friends on group boards and the leaderboard at the
[CodeTrackr dashboard](https://code-trackr-frontend.vercel.app).

On the dashboard you also see how your week split between writing, reading and running, your top
files, and Insights for each kind of work: DSA practice, project work, and learning & setup.

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

## What's new in 2.6.0

- **Accurate time** — counted from what you actually do, second by second: typing is *writing*;
  scrolling, moving around and switching files is *reading*; a command, task, debug session or
  Code Runner run you are waiting on is *running* (typing with a server running is still writing).
  A pause over 60 s counts nothing, and time goes to the file you
  were in.
- **What kind of work** — pick *DSA / Project / Debugging / Learning / Setup* in the status bar, or
  leave it on *Auto*. It labels your session only when you choose or confirm it that session.
- **More private** — the text of terminal commands is no longer sent, only their kind.

## Also built in

- **Sign In** — connect with a short code instead of copying an API key.
- **Nothing lost offline** — every upload is saved before it is sent and retried oldest first,
  even after VS Code restarts. Retries are counted once on the server.
- **Key in your OS keychain** — the key is kept in VS Code's SecretStorage, never in
  `settings.json`.
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
| CodeTrackr: Set What I'm Working On | Tell CodeTrackr the kind of work (also: click it in the status bar) |
| CodeTrackr: Flush Now | Sends the current interval immediately |
| CodeTrackr: Start / Stop Tracking | Pause and resume tracking |
| CodeTrackr: Setup API Key | Older way to connect: paste a key from the dashboard's Profile page |

## What is tracked, and what is not

**Sent** (a small summary after about 2 minutes of real activity):
- active time split into writing, reading and running, and the project (workspace folder) name;
- the **names of the files** you worked on (base names like `two_sum.cpp`, never folders or full
  paths), each with its time, language and line counts, up to 30 per summary;
- edit counts (lines added and removed, saves, undo), window-focus time;
- commit counts; debug sessions, breakpoint stops and steps;
- programs you ran: terminal commands, tasks, *Run Without Debugging*, Code Runner (counts only);
- terminal commands by kind (install, run, compile, build, test, git, docker, other) and whether
  they failed, including which kind keeps failing ("compile, 3 times");
- reading counts: scroll bursts, jumps, files opened but not edited; files created and deleted;
- the kind of project: a size range of source files, whether it has `package.json`,
  `requirements.txt` or `.git`, whether recent commits are yours, whether it was cloned recently;
- the work mode you chose in the status bar, if any.

**Never sent:** file contents, diffs, commit messages, full file paths, keystrokes, your Git email,
and (since 2.6.0) the text of your terminal commands.

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
- **Uploads failed earlier and are still waiting.** They are sent with your next upload, or at once
  when you run **Developer: Reload Window**.
- **The extension says your key was rejected.** Device keys expire after a year, or the device was
  disconnected on the Profile page. Run **Sign In** again.

## About

Built by Pratik Jambhule, Kartik Kharat and Soham Budhewar.
Source: [github.com/PratikJambhule/CodeTrackr](https://github.com/PratikJambhule/CodeTrackr) ·
License: MIT
