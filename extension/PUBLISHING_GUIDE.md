
# VS Code Extension Publishing Guide

This guide provides a step-by-step process for publishing your VS Code extension to the Visual Studio Marketplace.

## 1. Prerequisites

Before you begin, ensure you have the following:

*   **Node.js and npm**: Make sure you have Node.js and npm installed on your system. You can download them from [https://nodejs.org/](https://nodejs.org/).
*   **VS Code Extension Project**: You should have an existing VS Code extension project ready for publication.
*   **Microsoft Account**: You'll need a Microsoft account to create an Azure DevOps organization and manage your publisher.

## 2. Install the `vsce` CLI Tool

`vsce` (Visual Studio Code Extensions) is the command-line tool used for packaging, publishing, and managing VS Code extensions.

Open your terminal or command prompt and install it globally using npm:

```bash
npm install -g @vscode/vsce
```

## 3. Create an Azure DevOps Organization

The VS Code Marketplace uses Azure DevOps for its services.

*   Go to [https://dev.azure.com/](https://dev.azure.com/) and sign in with your Microsoft account.
*   If you don't have an organization, create a new one.

## 4. Generate a Personal Access Token (PAT)

`vsce` uses Personal Access Tokens (PATs) for authentication.

*   Once logged into Azure DevOps, click on your profile icon (top-right corner) and select "Personal access tokens" under "User settings".
*   Click "New Token".
*   Configure the token with the following details:
    *   **Name**: Give it a descriptive name (e.g., "VS Code Extension Publishing").
    *   **Organization**: Select "All accessible organizations".
    *   **Expiration**: Set an appropriate expiration date (e.g., 1 year).
    *   **Scopes**: Choose "Custom defined", then click "Show all scopes". Scroll down to "Marketplace" and select the "Manage" scope.
*   Click "Create".
*   **Copy the generated token immediately**. It will only be shown once. Store it in a secure place.

## 5. Create a Publisher

A publisher is an identity under which your extensions will be listed in the Marketplace.

*   Go to the Visual Studio Marketplace publisher management page: [https://marketplace.visualstudio.com/manage](https://marketplace.visualstudio.com/manage).
*   Log in with the same Microsoft account used for your PAT.
*   Click "Create publisher" in the left pane.
*   Specify a unique **ID** and a **Name** for your publisher. The ID is used in your `package.json` file.
*   You can also add optional details like a logo and website.

## 6. Login `vsce` with your Publisher

Navigate to your extension's root directory in the terminal.

Log in to `vsce` using your publisher ID:

```bash
vsce login <your-publisher-id>
```

When prompted, paste the Personal Access Token you generated earlier. `vsce` will remember this token for future commands.

## 7. Prepare Your Extension for Publishing

Ensure your `package.json` file has the necessary metadata and that your extension adheres to Marketplace guidelines.

*   **`package.json`**:
    *   Ensure the `publisher` field matches your publisher ID.
    *   Add `icon`, `repository`, `categories`, and `keywords` fields for better discoverability. The icon should be a 128x128px PNG file.
*   **`README.md` and `CHANGELOG.md`**: Provide clear and detailed documentation. A good `README.md` should include a description of your extension, how to use it, and any other relevant information.
*   **`.vscodeignore`**: Create this file in your extension's root to exclude unnecessary files (like `node_modules`, `src`, `tsconfig.json`, etc.) from the published `.vsix` package.
*   **Security**: `vsce` will not publish extensions containing user-provided SVG images in icons or badges unless they are from trusted providers. Image URLs in `README.md` and `CHANGELOG.md` must use HTTPS.

## 8. Adding a License

It is a good practice to include a license in your extension.

*   Create a `LICENSE` file in your extension's root directory.
*   Add the license text to this file. You can choose a license from [https://choosealicense.com/](https://choosealicense.com/).
*   Reference the license in your `package.json` file:

```json
{
  "license": "MIT"
}
```

## 9. Publish Your Extension

Once your extension is ready and you've logged in with `vsce`:

Navigate to your extension's root directory in the terminal.

Run the publish command:

```bash
vsce publish
```

`vsce` will automatically increment the patch version in your `package.json` and publish the extension.

You can also specify a version bump directly:

```bash
vsce publish major   # Bumps major version (e.g., 1.0.0 -> 2.0.0)
vsce publish minor   # Bumps minor version (e.g., 1.0.0 -> 1.1.0)
vsce publish patch   # Bumps patch version (e.g., 1.0.0 -> 1.0.1)
vsce publish 2.0.1   # Publishes a specific version
```

Alternatively, you can first package your extension into a `.vsix` file for local testing or manual sharing:

```bash
vsce package
```

This creates a `.vsix` file in your extension's root folder (e.g., `my-extension-0.0.1.vsix`).

## 10. Updating an Existing Extension

To update your extension:

1.  Make your desired changes to the extension code.
2.  Update the `version` field in your `package.json` file (e.g., from `1.0.0` to `1.0.1`).
3.  Update the `CHANGELOG.md` file with the changes in the new version.
4.  Run `vsce publish` again from your extension's root directory. `vsce` will detect the new version and publish the update to the Marketplace.
