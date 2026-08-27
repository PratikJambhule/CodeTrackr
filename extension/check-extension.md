# CodeTrackr Extension Troubleshooting

## Issue: Extension not showing "CodeTrackr: started" and not tracking activity

### Possible Causes:
1. **Extension not activated** - Check if extension is installed and enabled
2. **API key not configured** - Extension requires API key to function
3. **Backend not running** - Extension can't connect to backend server
4. **Extension needs reload** - VS Code needs to reload the extension

### Steps to Fix:

#### 1. Check if Extension is Installed
- Open VS Code
- Go to Extensions (Ctrl+Shift+X)
- Search for "CodeTrackr"
- Make sure it's installed and enabled

#### 2. Reload the Extension
Since we just rebuilt the extension, you need to reload VS Code:
- Press `Ctrl+Shift+P` (Command Palette)
- Type "Developer: Reload Window"
- Press Enter

#### 3. Check Extension Output
After reloading, check the output:
- Press `Ctrl+Shift+P`
- Type "Output"
- Select "Output: Show Output"
- In the dropdown, select "CodeTrackr" or "Extension Host"

#### 4. Configure API Key
If extension shows warning about API key:
- Press `Ctrl+Shift+P`
- Type "CodeTrackr: Setup API Key"
- Enter your API key from the dashboard

OR manually configure in settings:
- Press `Ctrl+,` (Settings)
- Search for "codetrackr"
- Set `Codetrackr: Api Key` to your API key
- Set `Codetrackr: Api Base` to `http://127.0.0.1:5050`

#### 5. Manually Start Tracking
- Press `Ctrl+Shift+P`
- Type "CodeTrackr: Start Tracking"
- Press Enter
- You should see "CodeTrackr: started ⏳" in the status bar

#### 6. Verify Backend is Running
Make sure your backend is running on port 5050:
```bash
cd C:\Users\prati\OneDrive\Desktop\CodeTrackr\backend
npm start
```

#### 7. Check Connection
- Press `Ctrl+Shift+P`
- Type "CodeTrackr: Show Connection Info"
- This will verify your API key and show your user info

### Expected Behavior:
- On VS Code startup: Should see "CodeTrackr: Connected as [Your Name]"
- After configuration: Should auto-start tracking
- Every 30 seconds: Should flush activity and show "CodeTrackr: Activity tracked ✅"
- On file changes: Activity is recorded locally
- On save/switch files: Activity is marked

### Debug Steps:
1. Check VS Code Developer Tools: Help > Toggle Developer Tools
2. Look for console messages starting with "CodeTrackr:"
3. Check for errors in red
4. Look for "💻 CodeTrackr extension activated" message

### Common Issues:

**Issue: "No API key configured"**
- Solution: Run "CodeTrackr: Setup API Key" command

**Issue: "Cannot connect to server"**
- Solution: Start backend with `npm start` in backend folder

**Issue: "Invalid API key"**
- Solution: Get new API key from dashboard at http://localhost:5173/profile

**Issue: Extension not appearing in command palette**
- Solution: Reinstall the extension or reload window

### Testing the Extension:
1. Reload VS Code window
2. Open any file in your workspace
3. Make some changes (add/delete lines)
4. Wait 30 seconds
5. You should see "CodeTrackr: Activity tracked ✅" in status bar
6. Check MongoDB - new activity should appear
