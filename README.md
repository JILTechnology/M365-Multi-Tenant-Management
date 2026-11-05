# M365 Multi Tenant Management

A desktop application for Managed Service Providers (MSPs) to manage multiple Microsoft 365 tenant accounts simultaneously using isolated browser sessions.

## Features

- Persistent, isolated Chromium sessions per Microsoft 365 tenant
- Isolated sessions for non-Microsoft custom sites and global tools
- Sidebar for quick tenant switching
- Admin portals for Entra, Microsoft 365, Intune, Exchange, Teams, SharePoint, Azure, and Security
- HTTPS-only custom portals and tools
- Password-protected configuration backups with a restore preview
- Active tenant banner and guarded executable/script downloads
- Local activity history and redacted diagnostic exports
- Optional screen-capture protection and automatic hiding on Windows lock
- Automatic cleanup of inactive pages without clearing sign-in sessions
- Live tenant, portal, tool, and settings synchronization across app windows
- Windows desktop app (.exe installer)
- Native editing shortcuts and right-click Copy/Paste in portals, forms, and pop-up windows

## Tech Stack

- **Electron** - Desktop application framework (Chromium + Node.js)
- **React** - User interface
- **TypeScript** - Type safety
- **Vite** - Build tooling (via Electron Forge)

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 22.12+
- npm 11+

### Getting Started

```bash
# Install dependencies
npm install

# Start the app in development mode
npm start
```

### Building

Windows release builds fail closed unless a code-signing certificate is configured:

```powershell
$env:WINDOWS_CERTIFICATE_FILE = 'C:\secure\codesigning.pfx'
$env:WINDOWS_CERTIFICATE_PASSWORD = '<read from your secret manager>'
```

```bash
# Package a signed app (no installer)
npm run package

# Build a signed distributable installer
npm run make

# Explicit local-only unsigned builds
npm run package:unsigned
npm run make:unsigned

# Type-check and run unit tests
npm run verify

# Exercise native keyboard and context-menu editing in disposable Electron windows
npm run test:editing
```

Never commit the certificate or its password. Automatic self-update is intentionally
disabled; the in-app update check opens the GitHub releases page for a manually
verified installer.

The signed release workflow in `.github/workflows/release.yml` requires these
GitHub Actions secrets:

- `WINDOWS_CERTIFICATE_BASE64` - Base64-encoded PFX certificate bytes
- `WINDOWS_CERTIFICATE_PASSWORD` - PFX password

Tagging a commit as `v<package-version>` runs tests and the dependency audit,
builds the signed Squirrel installer, verifies Authenticode, exercises an in-place
upgrade against the previous release when one is available, uploads the artifacts,
and publishes the GitHub release. The upgrade test is restricted to disposable CI
unless `-AllowLocalMachine` is explicitly passed to the script.

### Backups

Backups contain tenant, portal, tool, last-tab, window, and application settings
only. Password protection uses authenticated encryption; the password is never
stored by the app. Cookies, tokens, caches, and other browser-session data are
never exported or restored. Before applying a restore, the app shows additions,
removals, and changes and saves a local recovery copy.

Restoring configuration on the same Windows profile preserves matching tenant
sessions because tenant IDs are retained. Restoring to a new machine requires
signing in again. Configuration schema migrations add new settings without
renaming tenant or custom portal session IDs.

### Privacy and performance settings

Open **Settings** in the sidebar to control screen-capture protection, hiding app
windows when Windows locks, the inactive-page timeout, and the maximum number of
live remote pages. Closing an inactive page releases memory; selecting it again
reloads the page from the same persistent partition and normally remains signed in.

The activity log is stored locally and keeps the latest 500 management and download
events. The diagnostic export intentionally omits tenant names, domains, URLs,
browser sessions, and local paths.

## License

MIT
