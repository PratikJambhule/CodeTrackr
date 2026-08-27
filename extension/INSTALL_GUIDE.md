# CodeTrackr Extension v2.0.0 - Installation Guide

## 🎉 What's New in Version 2.0.0

This is a **major update** that adds API key authentication for secure tracking!

### Key Features:
- ✅ **Secure API Key Authentication** - Each user gets a unique API key
- ✅ **Guided Setup** - Extension prompts you to configure API key on first use
- ✅ **Connection Verification** - Validates your API key on startup
- ✅ **Enhanced Security** - All requests authenticated via API key
- ✅ **Better Error Handling** - Clear messages for configuration issues
- ✅ **User Info Display** - See who you're connected as

## 📦 Installation Options

### Option 1: Install from .vsix File (Recommended)

1. **Locate the package file:**
   ```
   extension/codetrackr-vscode-2.0.0.vsix
   ```

2. **Install in VS Code:**
   - Open VS Code
   - Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
   - Type: `Extensions: Install from VSIX`
   - Select the `codetrackr-vscode-2.0.0.vsix` file
   - Click "Install"

3. **Reload VS Code** when prompted

### Option 2: Install from Command Line

```bash
code --install-extension extension/codetrackr-vscode-2.0.0.vsix
```

## ⚙️ Configuration Steps

### Step 1: Get Your API Key

1. Open your browser and go to: http://localhost:5173 (or your hosted URL)
2. Sign in with Google OAuth
3. Navigate to **Profile** page (click on your name in the nav bar)
4. Copy your API key (it's a long hexadecimal string)

### Step 2: Configure the Extension

**Method A: Automatic (Recommended)**
1. Open VS Code
2. The extension will show a notification: "Please configure your API key"
3. Click "Enter API Key"
4. Paste your API key
5. Press Enter
6. You should see: "API key configured successfully! Welcome, [Your Name]! 🎉"

**Method B: Manual**
1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P`)
2. Type: `CodeTrackr: Setup API Key`
3. Paste your API key
4. Press Enter

**Method C: Via Settings**
1. Go to: File > Preferences > Settings
2. Search for: `codetrackr.apiKey`
3. Paste your API key in the text field
4. Restart VS Code

### Step 3: Verify Connection

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P`)
2. Type: `CodeTrackr: Show Connection Info`
3. You should see your name and email
4. If invalid, you'll see an error message

## 🚀 Start Tracking

Once configured, the extension automatically starts tracking your coding activity!

You should see:
- Status bar message: "CodeTrackr: Connected as [Your Name]"
- Activity tracked every 30 seconds
- Data synced to your dashboard

## 📊 View Your Stats

1. Go to: http://localhost:5173/dashboard
2. See your:
   - Total coding hours
   - Projects worked on
   - Languages used
   - Daily activity charts
   - Lines of code written

## 🔧 Available Commands

Access via Command Palette (`Ctrl+Shift+P`):

| Command | Description |
|---------|-------------|
| `CodeTrackr: Setup API Key` | Configure or update your API key |
| `CodeTrackr: Show Connection Info` | View connection status |
| `CodeTrackr: Start Tracking` | Start tracking (usually automatic) |
| `CodeTrackr: Stop Tracking` | Pause tracking temporarily |
| `CodeTrackr: Flush Now` | Send buffered data immediately |

## 🛠️ Troubleshooting

### Extension installed but not tracking?

**Check API Key:**
```
Ctrl+Shift+P → CodeTrackr: Show Connection Info
```
If invalid, reconfigure your API key.

**Check Backend:**
Make sure your backend is running on http://localhost:5050

### "Invalid API key" error?

1. Go to dashboard: http://localhost:5173/profile
2. **Regenerate** your API key if needed
3. Copy the new key
4. Run: `CodeTrackr: Setup API Key`
5. Paste new key

### Activity not showing in dashboard?

1. Run: `CodeTrackr: Flush Now` to send data immediately
2. Refresh your dashboard
3. Wait a few seconds for data to sync

### Backend not running?

```bash
cd backend
npm run dev
```

Backend should be running on port 5050.

## 📝 Configuration Options

### Settings (File > Preferences > Settings)

**Required:**
- `codetrackr.apiKey` - Your API key from dashboard

**Optional:**
- `codetrackr.apiBase` - Backend URL (default: http://127.0.0.1:5050)
- `codetrackr.flushIntervalSeconds` - How often to send data (default: 30)
- `codetrackr.minFlushMinutes` - Minimum activity before sending (default: 0.5)

### Example Configuration

```json
{
  "codetrackr.apiKey": "your-64-char-api-key-here",
  "codetrackr.apiBase": "http://localhost:5050",
  "codetrackr.flushIntervalSeconds": 30,
  "codetrackr.minFlushMinutes": 0.5
}
```

## 🔒 Security Notes

- API key is stored securely in VS Code settings
- Never share your API key with anyone
- Regenerate your key if you suspect it's compromised
- All data transmitted securely (HTTPS in production)

## 📈 What Gets Tracked?

**Tracked:**
- ⏱️ Time spent coding
- 📄 File names (basename only)
- 💻 Programming languages
- 📁 Project names
- ➕ Lines added
- ➖ Lines removed

**NOT Tracked:**
- ❌ File contents or code
- ❌ Keystrokes
- ❌ Personal information
- ❌ Passwords or secrets

## ⬆️ Upgrading from v1.x

### Breaking Changes

1. **API Key Required:** Version 2.0.0 requires API key authentication
2. **userId Deprecated:** `codetrackr.userId` setting no longer used
3. **New Endpoint:** Uses `/api/extension/track` instead of `/api/user-activity`

### Upgrade Steps

1. Update backend to version 2.0.0+
2. Install extension v2.0.0
3. Get API key from dashboard
4. Configure API key in extension
5. Remove old `codetrackr.userId` setting (optional)

## 💡 Tips

- **Auto-Start:** Extension starts automatically when VS Code opens
- **Manual Control:** Use Start/Stop commands if needed
- **Immediate Sync:** Use "Flush Now" to send data immediately
- **Check Status:** Use "Show Connection Info" anytime to verify

## 🆘 Need Help?

- **GitHub Issues:** https://github.com/Soham-Official/CodeTrackr/issues
- **Documentation:** See `API_INTEGRATION.md` in project root
- **Backend Logs:** Check terminal running `npm run dev` in backend folder

## 📦 Files Included

- `codetrackr-vscode-2.0.0.vsix` - Extension package (87 KB)
- `extension.js` - Source code
- `dist/extension.js` - Bundled code (435 KB)
- `package.json` - Extension manifest
- `README.md` - Documentation
- `CHANGELOG.md` - Version history
- `images/icon.png` - Extension icon

## 🎯 Next Steps

1. ✅ Install the extension
2. ✅ Configure your API key
3. ✅ Start coding!
4. ✅ Check your dashboard
5. ✅ Set some goals
6. ✅ Join the leaderboard

---

**Happy Coding! 🚀**

Version 2.0.0 | January 2024 | MIT License
