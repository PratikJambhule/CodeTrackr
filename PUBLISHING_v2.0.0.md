# Publishing CodeTrackr v2.0.0 to VS Code Marketplace

## 📋 Pre-Publishing Checklist

Before publishing, ensure you have:
- [x] ✅ Extension packaged: `codetrackr-vscode-2.0.0.vsix`
- [x] ✅ Version updated: `2.0.0` in package.json
- [x] ✅ CHANGELOG.md updated with v2.0.0 changes
- [x] ✅ README.md updated with new features
- [x] ✅ All code built and tested
- [ ] ⏳ Microsoft Account (for Azure DevOps)
- [ ] ⏳ Personal Access Token (PAT)
- [ ] ⏳ Publisher ID configured

---

## 🚀 Step-by-Step Publishing Process

### Step 1: Create Microsoft Account (if needed)

1. Go to https://account.microsoft.com
2. Create or sign in with your Microsoft account
3. Remember your credentials for Azure DevOps

### Step 2: Create Azure DevOps Organization

1. Go to https://dev.azure.com/
2. Sign in with your Microsoft account
3. Click **"Create new organization"** (if you don't have one)
4. Choose a unique organization name
5. Complete the setup

### Step 3: Generate Personal Access Token (PAT)

**IMPORTANT:** This token is required for publishing!

1. In Azure DevOps, click your profile icon (top-right)
2. Select **"Personal access tokens"**
3. Click **"+ New Token"**
4. Configure the token:
   - **Name:** `CodeTrackr VS Code Publishing`
   - **Organization:** Select "All accessible organizations"
   - **Expiration:** 1 year (or as needed)
   - **Scopes:** Click "Show all scopes" → Scroll to **"Marketplace"** → Check **"Manage"**
5. Click **"Create"**
6. **COPY THE TOKEN IMMEDIATELY** (it's only shown once!)
7. Save it securely (you'll need it in Step 5)

### Step 4: Create Publisher Account

1. Go to https://marketplace.visualstudio.com/manage
2. Sign in with your Microsoft account
3. Click **"Create publisher"**
4. Fill in the details:
   - **ID:** Choose a unique ID (e.g., `codetrackr-team` or `soham-dev`)
   - **Name:** Display name (e.g., `CodeTrackr Team`)
   - **Email:** Your contact email
5. Click **"Create"**
6. **Remember your Publisher ID** (you'll need it next)

### Step 5: Update package.json with Publisher ID

Open `extension/package.json` and update the publisher field:

```json
{
  "publisher": "YOUR-PUBLISHER-ID-HERE"
}
```

Replace `YOUR-PUBLISHER-ID-HERE` with the Publisher ID from Step 4.

### Step 6: Login with vsce

Open terminal in the extension folder:

```bash
cd C:\Users\prati\OneDrive\Desktop\CodeTrackr\extension
```

Login with your publisher:

```bash
vsce login YOUR-PUBLISHER-ID-HERE
```

When prompted, paste your Personal Access Token (from Step 3).

**Expected output:**
```
Personal Access Token for publisher 'YOUR-PUBLISHER-ID-HERE': ****
The Personal Access Token verification succeeded for the publisher 'YOUR-PUBLISHER-ID-HERE'.
```

### Step 7: Publish to Marketplace

**Option A: Publish Directly (Recommended)**

```bash
vsce publish
```

This will:
1. Build the extension
2. Package it
3. Publish to marketplace
4. Your extension will be live in ~5-10 minutes

**Option B: Publish Pre-Built Package**

If you want to use the existing .vsix file:

```bash
vsce publish --packagePath codetrackr-vscode-2.0.0.vsix
```

### Step 8: Verify Publication

1. Go to https://marketplace.visualstudio.com/manage
2. Click on your publisher
3. You should see "CodeTrackr for VS Code" listed
4. Click on it to view the extension page

Your extension will be available at:
```
https://marketplace.visualstudio.com/items?itemName=YOUR-PUBLISHER-ID.codetrackr-vscode
```

---

## 🔧 Quick Reference Commands

```bash
# Login to publisher account
vsce login YOUR-PUBLISHER-ID

# Build extension
npm run build

# Package extension (creates .vsix file)
vsce package

# Publish to marketplace
vsce publish

# Publish specific version
vsce publish 2.0.0

# Publish from .vsix file
vsce publish --packagePath codetrackr-vscode-2.0.0.vsix

# Unpublish extension (use carefully!)
vsce unpublish YOUR-PUBLISHER-ID.codetrackr-vscode
```

---

## 📝 Important Notes

### Before Publishing:

1. **Test Locally First:**
   ```bash
   code --install-extension codetrackr-vscode-2.0.0.vsix
   ```

2. **Check package.json:**
   - `version`: Should be `2.0.0`
   - `publisher`: Should be your Publisher ID
   - `icon`: Should point to `images/icon.png`
   - `repository`: Should be correct GitHub URL

3. **Review Files:**
   - README.md has clear instructions
   - CHANGELOG.md lists all v2.0.0 changes
   - LICENSE is included

### Publisher ID in package.json:

Currently set to:
```json
"publisher": "CodeTrackr-ext"
```

You may need to:
1. Use the **existing publisher** `CodeTrackr-ext`, OR
2. Create a **new publisher** and update this field

### If Publisher Already Exists:

If `CodeTrackr-ext` is already claimed, you'll need to either:
- Get access to that publisher account, OR
- Create a new publisher ID (e.g., `codetrackr-official`, `soham-codetrackr`, etc.)

---

## 🐛 Troubleshooting

### "Publisher not found"
**Solution:** Create a publisher at https://marketplace.visualstudio.com/manage

### "Personal Access Token invalid"
**Solution:** 
1. Generate a new PAT in Azure DevOps
2. Ensure "Marketplace > Manage" scope is selected
3. Re-login: `vsce login YOUR-PUBLISHER-ID`

### "Extension name already exists"
**Solution:** 
1. Change the `name` field in package.json, OR
2. Contact existing publisher to claim ownership

### "Authentication failed"
**Solution:**
```bash
vsce logout
vsce login YOUR-PUBLISHER-ID
```
Then enter your PAT again.

### "ENOENT: no such file or directory"
**Solution:** Run from the extension folder:
```bash
cd C:\Users\prati\OneDrive\Desktop\CodeTrackr\extension
```

---

## ✅ Post-Publishing Checklist

After publishing:

1. **Verify on Marketplace:**
   - Search for "CodeTrackr" on VS Code Marketplace
   - Check extension page loads correctly
   - Verify README displays properly
   - Check icon appears

2. **Install from Marketplace:**
   ```bash
   code --install-extension YOUR-PUBLISHER-ID.codetrackr-vscode
   ```

3. **Test Installation:**
   - Open VS Code
   - Press Ctrl+Shift+X
   - Search "CodeTrackr"
   - Install and test

4. **Announce Update:**
   - Update GitHub repository
   - Notify users about v2.0.0
   - Share on social media

5. **Monitor Reviews:**
   - Check marketplace reviews
   - Respond to user feedback
   - Fix any reported issues

---

## 🔄 Updating in the Future

To publish version 2.0.1 or later:

1. Make code changes
2. Update `package.json` version: `2.0.1`
3. Update `CHANGELOG.md` with changes
4. Run: `vsce publish`

**Auto-increment versions:**
```bash
vsce publish patch   # 2.0.0 → 2.0.1
vsce publish minor   # 2.0.0 → 2.1.0
vsce publish major   # 2.0.0 → 3.0.0
```

---

## 📞 Support

If you encounter issues:
- **vsce Documentation:** https://code.visualstudio.com/api/working-with-extensions/publishing-extension
- **Marketplace Publishing:** https://marketplace.visualstudio.com/manage
- **Azure DevOps:** https://dev.azure.com/

---

## 🎯 Summary - Quick Steps

```bash
# 1. Create Microsoft Account & Azure DevOps org
# 2. Generate PAT with Marketplace > Manage scope
# 3. Create publisher at marketplace.visualstudio.com/manage
# 4. Update publisher ID in package.json

# 5. Login
cd C:\Users\prati\OneDrive\Desktop\CodeTrackr\extension
vsce login YOUR-PUBLISHER-ID
# (paste your PAT when prompted)

# 6. Publish
vsce publish

# 7. Done! Extension will be live in 5-10 minutes
```

---

**Good luck with your publication! 🚀**

Your extension is ready and waiting at: `codetrackr-vscode-2.0.0.vsix`
