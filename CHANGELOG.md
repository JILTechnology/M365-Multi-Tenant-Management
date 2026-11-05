# Changelog

## 0.1.7 - 2026-11-05

- Added a Browse tab to each tenant for opening pasted links in that tenant's signed-in session.
- Made the address bar editable: click it, paste an HTTPS URL, and press Enter to open it in the current page.
- Added Ctrl+9 to jump to the Browse tab.

## 0.1.6 - 2026-09-17

- Restored native copy, paste, cut, select-all, and undo keyboard shortcuts.
- Added editing actions to right-click menus in portal pages, app forms, and pop-up windows.
- Kept existing portal navigation actions and disabled unavailable editing actions.

## 0.1.5 - 2026-08-14

- Added password-protected portable configuration backups and restore previews.
- Added formal configuration migrations that retain stable session partition IDs.
- Added an active tenant/tool banner and warnings for executable or script downloads.
- Added optional capture protection and automatic window hiding on Windows lock.
- Added bounded local activity history and redacted diagnostic exports.
- Added inactive page eviction without clearing persistent browser sessions.
- Added live synchronization between multiple app windows.
- Added signed release, Authenticode verification, and in-place upgrade automation.
- Added an in-app settings, version, and release notes view.

## 0.1.4 - 2026-08-14

- Hardened Electron navigation, permissions, popups, IPC validation, and session cleanup.
- Added configuration-only backup and restore with stable session-binding checks.
- Updated the Electron toolchain and enforced signed production packaging.
- Fixed the Windows AppUserModelID used by installed and pinned shortcuts.
