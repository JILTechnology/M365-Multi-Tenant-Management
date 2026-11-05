import { app, BrowserWindow, dialog, shell } from 'electron';
import type { Session, WebContents } from 'electron';
import path from 'node:path';
import { recordAudit } from './audit-log';
import { assessDownload } from './download-policy';
import { getPreferences } from './store';
import { isHttpsUrl, isMicrosoftOwnedUrl } from './url-policy';
import { installEditingContextMenu } from './editing-menu';

const configuredSessions = new WeakSet<Session>();

type ParentWindowProvider = () => BrowserWindow | null;

function resolveDownloadParent(
  webContents: WebContents,
  parentWindowProvider?: ParentWindowProvider,
): BrowserWindow | null {
  const directWindow = BrowserWindow.fromWebContents(webContents);
  if (directWindow && !directWindow.isDestroyed()) return directWindow;
  const providedWindow = parentWindowProvider?.();
  if (providedWindow && !providedWindow.isDestroyed()) return providedWindow;
  return BrowserWindow.getAllWindows().find((window) => !window.isDestroyed()) ?? null;
}

export function configureRemoteSession(
  remoteSession: Session,
  parentWindowProvider?: ParentWindowProvider,
): void {
  if (configuredSessions.has(remoteSession)) return;
  configuredSessions.add(remoteSession);

  remoteSession.setPermissionCheckHandler(() => false);
  remoteSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  remoteSession.setDevicePermissionHandler(() => false);
  remoteSession.setDisplayMediaRequestHandler((_request, callback) => {
    callback({});
  });

  remoteSession.on('will-download', (event, item, webContents) => {
    const assessment = assessDownload(item.getURLChain(), item.getFilename());
    if (!assessment.allowedProtocol) {
      event.preventDefault();
      recordAudit({
        action: 'download.block',
        outcome: 'blocked',
        target: assessment.filename,
        detail: 'A non-HTTPS download or redirect was blocked.',
      });
      return;
    }

    if (assessment.dangerous) {
      const options: Electron.MessageBoxSyncOptions = {
        type: 'warning',
        title: 'Potentially Dangerous Download',
        message: `Download ${assessment.filename}?`,
        detail: `${assessment.sourceHost} is providing a ${assessment.extension || 'file'} that can run code or change this computer. Only continue when you expected this exact file.`,
        buttons: ['Cancel', 'Download'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
      };
      const parentWindow = resolveDownloadParent(webContents, parentWindowProvider);
      const response = parentWindow
        ? dialog.showMessageBoxSync(parentWindow, options)
        : dialog.showMessageBoxSync(options);
      if (response !== 1) {
        event.preventDefault();
        recordAudit({
          action: 'download.confirmation',
          outcome: 'canceled',
          target: assessment.filename,
          detail: `${assessment.sourceHost}; ${assessment.extension}`,
        });
        return;
      }
    }

    item.setSaveDialogOptions({
      title: `Save download from ${assessment.sourceHost}`,
      defaultPath: path.join(app.getPath('downloads'), assessment.filename),
      buttonLabel: 'Save',
    });
    recordAudit({
      action: 'download.start',
      outcome: 'success',
      target: assessment.filename,
      detail: `${assessment.sourceHost}; ${assessment.extension || 'no extension'}`,
    });
    item.once('done', (_doneEvent, state) => {
      recordAudit({
        action: 'download.finish',
        outcome: state === 'completed'
          ? 'success'
          : state === 'cancelled'
            ? 'canceled'
            : 'failed',
        target: assessment.filename,
        detail: `${assessment.sourceHost}; ${state}; ${item.getReceivedBytes()} bytes`,
      });
    });
  });
}

export async function openExternalHttps(url: string): Promise<boolean> {
  if (!isHttpsUrl(url)) return false;
  await shell.openExternal(url);
  return true;
}

function preventUnsafeRemoteNavigation(contents: WebContents): void {
  const blockUnsafeNavigation = (event: Electron.Event, url: string) => {
    if (!isHttpsUrl(url)) event.preventDefault();
  };

  contents.on('will-navigate', blockUnsafeNavigation);
  contents.on('will-redirect', blockUnsafeNavigation);
  contents.on('will-attach-webview', (event) => event.preventDefault());
}

export function hardenRemoteWebContents(contents: WebContents): void {
  installEditingContextMenu(contents);
  preventUnsafeRemoteNavigation(contents);
  contents.setWindowOpenHandler(({ url }) => {
    const openerUrl = contents.getURL();
    const sameOrigin =
      isHttpsUrl(openerUrl) &&
      isHttpsUrl(url) &&
      new URL(openerUrl).origin === new URL(url).origin;
    const microsoftFlow = isMicrosoftOwnedUrl(openerUrl) && isMicrosoftOwnedUrl(url);

    if (sameOrigin || microsoftFlow) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
            webviewTag: false,
            navigateOnDragDrop: false,
          },
        },
      };
    }

    void openExternalHttps(url).catch(() => undefined);
    return { action: 'deny' };
  });
  contents.on('did-create-window', (childWindow) => {
    childWindow.setMenuBarVisibility(false);
    childWindow.setContentProtection(getPreferences().contentProtection);
    configureRemoteSession(childWindow.webContents.session, () => childWindow);
    hardenRemoteWebContents(childWindow.webContents);
  });
}

export function hardenMainWebContents(
  contents: WebContents,
  isTrustedRendererUrl: (url: string) => boolean,
): void {
  installEditingContextMenu(contents);
  const blockUntrustedNavigation = (event: Electron.Event, url: string) => {
    if (isTrustedRendererUrl(url)) return;
    event.preventDefault();
    void openExternalHttps(url).catch(() => undefined);
  };

  contents.on('will-navigate', blockUntrustedNavigation);
  contents.on('will-redirect', blockUntrustedNavigation);
  contents.on('will-attach-webview', (event) => event.preventDefault());
  contents.setWindowOpenHandler(({ url }) => {
    void openExternalHttps(url).catch(() => undefined);
    return { action: 'deny' };
  });
}
