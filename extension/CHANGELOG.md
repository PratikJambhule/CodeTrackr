# Change Log

All notable changes to the CodeTrackr VS Code extension will be documented in this file.

## [2.3.0] - 2026-09-08

### Changed
- The backend now merges flushes into 10-minute activity records, so the extension
  no longer needs to send one every 30 seconds. `minFlushMinutes` now defaults to
  **2** (was 0.5) — fewer, coarser records, no change to reported totals.

### Fixed
- Flush intervals with no real activity (window focused but no edits, commands or
  commits) are no longer sent. The buffered time carries to the next real flush,
  which also stops sub-2-minute idle stretches from inflating coding time.

---


## [2.2.0] - 2026-08-28

> **Why 2.2.0 and not 2.1.0?** A build was published as `2.1.0` on 2026-05-08, before
> `2.0.10`. Because the Marketplace serves the highest *version number* rather than the most
> recent upload, that May build has been served as "latest" ever since — and the `2.0.11`
> fixes never reached anyone. This release supersedes it.

### Fixed
- **Terminal analytics recorded almost nothing.** The build being served as latest predated the
  terminal tracker entirely: it reported a cumulative `terminalErrorCount` that was never reset
  and left every other terminal field at zero. Command counts, build/test runs, per-tool usage
  and git activity now populate correctly, and counters reset each flush.

### Added
- **Editor analytics**: gross characters and lines inserted/deleted, churn (lines written
  then deleted within 10 minutes), undo/redo counts, saves, file switches, unique files,
  and a read-vs-write attention split.
- **Focus analytics**: real window focus/blur time and completed "flow blocks", so the
  shape of a session is recorded rather than just its total.
- **Git analytics**: commits are now detected through the built-in Git extension, so
  commits made from the Source Control panel or any GUI are counted.

### Fixed
- `linesAdded`/`linesRemoved` were net `lineCount` deltas, so any replace-in-place edit
  (most refactoring) recorded as zero activity. They are now gross counters.

### Privacy
- No file contents, diffs, commit messages or absolute paths are transmitted.

---


## [2.0.11] - 2026-08-27

### Fixed
- **Critical: default backend URL pointed at localhost.** `codetrackr.apiBase` defaulted to
  `http://127.0.0.1:5050`, so activity from marketplace installs never reached the CodeTrackr
  backend. It now defaults to the production API again (regression introduced after 2.0.6).
- **Critical: packaging never compiled the TypeScript.** `vscode:prepublish` ran esbuild against
  `dist/extension.js` without invoking `tsc`, so packaging failed on a clean checkout and
  shipped stale code otherwise. The build now bundles directly from `src/extension.ts` and
  type-checks first.
- **"Setup API Key" and "Show Connection Info" did nothing.** Both commands were listed in the
  Command Palette but never registered, so they failed with "command not found". They are now
  implemented: `Setup API Key` prompts for the key, saves it, and verifies it against the
  backend; `Show Connection Info` reports the backend URL, masked key and live connection status.
- **Missing or rejected API keys failed silently.** A 401 only produced a 3-second status bar
  message. The extension now shows an actionable prompt with "Set API Key" and "Open Dashboard".
- **Debug tracking was discarded.** Debug session data was written only to an internal queue that
  posted to a non-existent endpoint. Debug sessions now count toward the activity payload.
- **`flushIntervalSeconds` and `minFlushMinutes` settings were ignored** — both were hardcoded.
  They are now honoured, and changing the flush interval restarts the timer immediately.
- Activity is now stamped with the **start** of the flush interval rather than the moment of
  upload, correcting hour-of-day analytics.
- Zero-second and implausible durations are no longer sent (the backend rejected them with a 400).
- A final flush is attempted on deactivate so the tail of a session is not lost.

### Removed
- Dead `EventLogger`/`SyncService` pipeline. It posted batches to `/api/extension/events` — a
  route that does not exist — without an API key, every 30 seconds, retaining every failed batch
  in memory. No data was ever delivered through it.
- Deprecated `codetrackr.userId` setting (authentication has been API-key based since 2.0.0).

### Changed
- The packaged `.vsix` no longer contains the legacy v1 `extension.js`, developer test scripts,
  or internal guides. `README.md` is now included, so the Marketplace page renders correctly.

---


## [2.0.6] - 2025-11-16

### Changed
- **Production Ready**: Default API base URL now points to production backend (https://codetrackr-backend-uckp.onrender.com)
- **Frontend Links**: All profile/dashboard links now point to production frontend (https://code-trackr-frontend.vercel.app)
- Users can still override API base URL in settings if needed

---

## [2.0.5] - 2025-11-11

### Fixed
- **Critical Bug**: Fixed idle time being tracked and reported as active coding time
- **Accurate Time Tracking**: Extension now correctly calculates only active coding duration
- **Pause Logic**: No longer sends "activity tracked" messages during idle periods

### Improved
- Only tracks time from session start to last real activity (not total elapsed time)
- Better detection of when user stops coding vs actually coding
- More accurate activity reports sent to backend

---

## [2.0.4] - 2025-11-11

### Added
- **Smart Pause/Resume**: Automatically pauses tracking after 2 minutes of inactivity
- **Activity Detection**: Resumes tracking automatically when user starts coding again
- **Better Battery Life**: Reduces unnecessary API calls during idle periods

### Changed
- Tracking now pauses after 2 minutes of no coding activity
- Shows "Paused (idle) ⏸️" status when inactive
- Shows "Tracking resumed ▶️" when user starts coding again
- Flushes buffered data before pausing

### Improved
- Smarter activity detection to avoid tracking idle time
- More accurate coding time tracking
- Better status bar feedback for pause/resume states

---

## [2.0.3] - 2025-11-11

### Added
- **Auto-start on VS Code Launch**: Extension now automatically starts tracking when VS Code opens (if API key is configured)
- **API Key Verification**: Validates API key on startup and shows connection status
- **Welcome Messages**: User-friendly onboarding messages for new users without API key

### Improved
- **Startup Experience**: Better user feedback with welcome messages and setup guidance
- **Connection Status**: Shows "Connected as [Name]" message on successful API key verification
- **Error Handling**: Enhanced error messages with actionable suggestions
- **Extension Stability**: Fixed issues with extension not starting automatically

### Changed
- Extension now auto-verifies API key and starts tracking on activation
- Improved status bar messages for better user feedback
- Better handling of missing API key scenarios

---

## [2.0.2] - 2024-01-21

### Fixed
- **Connection Issues**: Enhanced error handling and logging for better debugging
- **Backend Communication**: Fixed data transmission issues with backend API
- **Error Messages**: More detailed error messages showing status codes and specific issues
- **Connection Errors**: Better handling of ECONNREFUSED when backend is offline

### Changed
- Improved console logging for debugging connection issues
- Added specific error messages for different failure scenarios (401, 400, connection refused)

---

## [2.0.1] - 2024-01-21

### Changed
- **Updated Authors**: Now properly credits all three core developers:
  - Pratik Jambhule (https://github.com/PratikJambhule)
  - Kartik Kharat (https://github.com/kartik-kharat)
  - Soham (https://github.com/Soham-Official)
- Enhanced author information with GitHub profile links

---

## [2.0.0] - 2024-01-20

### 🚀 Major Update: API Key Authentication

#### Added
- **API Key Authentication System**: Secure authentication using unique API keys per user
- **Setup Wizard**: Automatic prompts to configure API key on first use
- **API Key Verification**: Validates API key on extension startup
- **New Commands**:
  - `CodeTrackr: Setup API Key` - Configure or update your API key
  - `CodeTrackr: Show Connection Info` - View connection status and user info
- **Enhanced Error Messages**: Clear feedback for authentication issues
- **Welcome Flow**: Guided onboarding for new users
- **Connection Status**: Real-time connection verification with backend
- **User Info Display**: Shows connected user's name and email

#### Changed
- **API Endpoint**: Now uses `/api/extension/track` instead of `/api/user-activity`
- **Authentication Method**: Switched from userId to API key authentication
- **Duration Format**: Changed from minutes (float) to seconds (integer)
- **File Path**: Now sends basename instead of full path for privacy
- **Error Handling**: Improved error messages and user notifications
- **Auto-Start**: Only starts tracking after API key is verified

#### Deprecated
- `codetrackr.userId` setting (no longer used, authentication via API key)

#### Fixed
- Improved error handling for network failures
- Better handling of missing API key  
- More accurate time tracking
- Fixed line counting edge cases

#### Security
- All requests authenticated via API key
- API key stored securely in VS Code settings
- Invalid API keys rejected immediately
- Better protection against unauthorized tracking

### Breaking Changes
⚠️ **Important**: Version 2.0.0 requires API key authentication. Users must:
1. Update to backend version 2.0.0+
2. Get API key from dashboard profile page
3. Configure API key in extension settings

---

## [1.0.6] - 2024-01-15

### Added
- Initial public release
- Automatic time tracking
- Line count tracking
- Project and language detection
- Configurable flush intervals

### Fixed
- Various bug fixes and improvements

---

## How to Update

1. Update the extension to version 2.0.0
2. Ensure your backend is updated to version 2.0.0+
3. Get your API key from the dashboard at `/profile`
4. Run command: `CodeTrackr: Setup API Key`
5. Paste your API key
6. Start coding! 🚀
- Automatic time tracking of coding activity.
- Language detection.
- Offline support.
- Customizable settings.
