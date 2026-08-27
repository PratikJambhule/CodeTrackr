# CodeTrackr for VS Code

**Track your coding activity automatically and level up your productivity!**

CodeTrackr is a powerful VS Code extension that automatically tracks your coding time, files edited, languages used, and lines of code written. All your data syncs securely with your CodeTrackr account.

![Version](https://img.shields.io/badge/version-2.0.11-blue.svg)
![License](https://img.shields.io/badge/license-MIT-green.svg)

## ✨ Features

- ⏱️ **Automatic Time Tracking**: Tracks coding time in real-time as you work
- 📊 **Detailed Analytics**: See your daily activity, language breakdown, and project stats
- 🔒 **Secure Authentication**: API key-based authentication for maximum security
- 🎯 **Goal Setting**: Set and track your coding goals
- 🏆 **Leaderboards**: Compete with other developers globally
- 👥 **Team Collaboration**: Join teams and track group progress
- 🚀 **Zero Configuration**: Auto-starts tracking once API key is set
- 📈 **Line Counter**: Tracks lines added and removed in real-time

## 🚀 Getting Started

### 1. Install the Extension

Install this extension from the VS Code marketplace or manually:
- Open VS Code
- Press `Ctrl+Shift+X` (or `Cmd+Shift+X` on Mac)
- Search for "CodeTrackr"
- Click Install

### 2. Get Your API Key

1. Go to [CodeTrackr Dashboard](https://code-trackr-frontend.vercel.app) (or your hosted instance)
2. Sign in with Google
3. Navigate to **Profile** page
4. Copy your API key

### 3. Configure the Extension

The extension will automatically prompt you to enter your API key on first use. Alternatively:

1. Press `Ctrl+Shift+P` (or `Cmd+Shift+P` on Mac)
2. Type "CodeTrackr: Setup API Key"
3. Paste your API key
4. Press Enter

That's it! Your coding activity will now be tracked automatically.

## 📋 Commands

Access these commands via the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`):

- **CodeTrackr: Setup API Key** - Configure or update your API key
- **CodeTrackr: Show Connection Info** - View your current connection status
- **CodeTrackr: Start Tracking** - Manually start tracking (usually automatic)
- **CodeTrackr: Stop Tracking** - Pause tracking temporarily
- **CodeTrackr: Flush Now** - Immediately send buffered activity to server

## ⚙️ Settings

Configure the extension in VS Code settings (`File > Preferences > Settings` or `Ctrl+,`):

### `codetrackr.apiKey` (Required)
Your CodeTrackr API key. Get it from your dashboard profile page.

**Example:**
```json
{
  "codetrackr.apiKey": "your-api-key-here"
}
```

### `codetrackr.apiBase`
Backend API URL. Defaults to the hosted CodeTrackr backend
(`https://codetrackr-backend-uckp.onrender.com`) — you do not need to change this.

Only override it if you are self-hosting:
```json
{
  "codetrackr.apiBase": "https://your-own-backend.example.com"
}
```

### `codetrackr.flushIntervalSeconds`
How often to check and send activity data. Default: `30` seconds

### `codetrackr.minFlushMinutes`
Minimum activity time before sending data. Default: `0.5` minutes

## 🔒 Privacy & Security

- **API Key Authentication**: Your API key is stored securely in VS Code's settings
- **Local Processing**: Activity tracking happens locally on your machine
- **Encrypted Transmission**: All data sent via HTTPS (in production)
- **No Passwords**: Uses secure API keys instead of passwords
- **You Control Your Data**: Delete your account anytime from the dashboard

## 📊 What's Tracked?

The extension tracks:
- **Time**: Duration of active coding sessions
- **Files**: Names of files you're working on
- **Languages**: Programming languages used
- **Projects**: Project/workspace names
- **Lines**: Lines of code added and removed
- **Timestamps**: When you're coding

**Not tracked:**
- File contents or code
- Keystrokes
- Personal information
- Passwords or secrets

## 🆕 What's New in v2.0.0

### Major Changes
- ✅ **API Key Authentication**: Now uses secure API keys instead of username
- ✅ **Improved Onboarding**: Guided setup process for new users
- ✅ **Better Error Handling**: Clear messages when API key is invalid
- ✅ **Auto-Setup Prompts**: Automatic prompts to configure API key
- ✅ **Connection Status**: New command to check connection status
- ✅ **Updated Endpoint**: Uses new `/api/extension/track` endpoint
- ✅ **Enhanced Security**: All requests authenticated via API key

### Breaking Changes
- `codetrackr.userId` setting has been **removed** (authentication is API-key based)
- Old endpoint `/api/user-activity` replaced with `/api/extension/track`
- API key is now **required** for tracking to work

## 🐛 Troubleshooting

### Extension not tracking?
1. Check if API key is configured: Run "CodeTrackr: Show Connection Info"
2. Verify API key is valid: Copy it from your dashboard profile
3. Check backend is running: Visit your API base URL in browser
4. Restart VS Code

### "Invalid API key" error?
1. Go to your CodeTrackr dashboard profile page
2. Copy your API key (make sure no extra spaces)
3. Run "CodeTrackr: Setup API Key" and paste it
4. If still fails, try regenerating your API key on the profile page

### Activity not showing in dashboard?
1. Run "CodeTrackr: Flush Now" to send buffered data immediately
2. Refresh your dashboard
3. Check backend logs for errors
4. Ensure `apiBase` URL is correct in settings

## 🤝 Contributing

Found a bug or have a feature request? 
- [Open an issue](https://github.com/Soham-Official/CodeTrackr/issues)
- [Submit a pull request](https://github.com/Soham-Official/CodeTrackr/pulls)

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details

## 🙏 Acknowledgments

Created with ❤️ by:
- **[Pratik Jambhule](https://github.com/PratikJambhule)** - Core Developer
- **[Kartik Kharat](https://github.com/kartik-kharat)** - Core Developer
- **[Soham](https://github.com/Soham-Official)** - Lead Developer

## 🔗 Links

- [GitHub Repository](https://github.com/Soham-Official/CodeTrackr)
- [Dashboard](https://code-trackr-frontend.vercel.app)
- [API Documentation](../API_INTEGRATION.md)

---

**Happy Coding! 🚀**

This is the VS Code extension for CodeTrackr, a time-tracking tool for developers. This extension automatically tracks your coding activity in Visual Studio Code and sends it to your CodeTrackr backend.

## Features

*   **Automatic Time Tracking**: Tracks your coding time without any manual start/stop commands.
*   **Language Detection**: Automatically detects the language you are using.
*   **Offline Support**: Caches your activity locally and sends it to the backend when you are online.
*   **Customizable**: Configure the API endpoint, user ID, and other settings.

## Prerequisites

*   [Visual Studio Code](https://code.visualstudio.com/)
*   A [CodeTrackr](https://github.com/Soham-Official/CodeTrackr) backend running and accessible from your machine.

## Usage

1.  **Install the extension** from the Visual Studio Marketplace.
2.  **Run `CodeTrackr: Setup API Key`** from the Command Palette (`Ctrl+Shift+P`) and paste the key from your profile page. The extension verifies it immediately.
3.  **Start coding!** The extension will automatically track your activity.

## Repository

The source code for this extension is available on GitHub at [https://github.com/Soham-Official/CodeTrackr](https://github.com/Soham-Official/CodeTrackr).

## Author

*   **Soham**

## Contributing

Contributions are welcome! Please open an issue or submit a pull request on the [GitHub repository](https://github.com/Soham-Official/CodeTrackr).

## Changelog

See the [CHANGELOG.md](CHANGELOG.md) file for details.

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

For more detailed instructions on how to publish this extension, see [PUBLISHING_GUIDE.md](PUBLISHING_GUIDE.md).