import { BrowserWindow, WebContentsView, clipboard, session } from 'electron';
import {
  type CustomPortalTabId,
  type PortalId,
  type TenantTabId,
  type ViewKey,
  type ContentBounds,
  type NavState,
  IPC_CHANNELS,
  PORTALS,
  getCustomPortalId,
  isCustomPortalTabId,
  makeCustomPortalTabId,
  makeTenantTabViewKey,
  makeToolViewKey,
} from '../types/index';
import { getCustomPortals, getPreferences, getTenants, getTools } from './store';
import { installEditingContextMenu } from './editing-menu';
import {
  configureRemoteSession,
  hardenRemoteWebContents,
  openExternalHttps,
} from './electron-security';
import {
  customPortalPartition,
  normalizeHttpsUrl,
  tenantPartition,
  toolPartition,
} from './url-policy';

export async function clearPersistentPartition(partition: string): Promise<void> {
  const persistentSession = session.fromPartition(partition);
  await persistentSession.closeAllConnections();
  await persistentSession.clearData();
}

export function clearTenantPartition(tenantId: string): Promise<void> {
  return clearPersistentPartition(tenantPartition(tenantId));
}

export function clearToolPartition(toolId: string): Promise<void> {
  return clearPersistentPartition(toolPartition(toolId));
}

export function clearCustomPortalPartition(portalId: string): Promise<void> {
  return clearPersistentPartition(`persist:custom-${portalId}`);
}

export class TenantViewManager {
  private views = new Map<ViewKey, WebContentsView>();
  private activeViewKey: ViewKey | null = null;
  private currentBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
  private mainWindow: BrowserWindow;
  private onNewWindow: () => void;
  private lastUsed = new Map<ViewKey, number>();
  private evictionTimer: ReturnType<typeof setInterval>;

  constructor(mainWindow: BrowserWindow, onNewWindow: () => void) {
    this.mainWindow = mainWindow;
    this.onNewWindow = onNewWindow;
    this.evictionTimer = setInterval(() => this.evictInactiveViews(), 60_000);
    this.evictionTimer.unref();
  }

  selectView(tenantId: string, tabId: TenantTabId): void {
    const tenant = getTenants().find((item) => item.id === tenantId);
    if (!tenant || typeof tabId !== 'string') return;
    if (
      !isCustomPortalTabId(tabId) &&
      !Object.prototype.hasOwnProperty.call(PORTALS, tabId)
    ) {
      return;
    }

    const key = makeTenantTabViewKey(tenantId, tabId);

    if (this.activeViewKey && this.activeViewKey !== key) {
      const current = this.views.get(this.activeViewKey);
      if (current) {
        current.setVisible(false);
      }
    }

    if (!this.views.has(key)) {
      if (isCustomPortalTabId(tabId)) {
        const customPortalId = getCustomPortalId(tabId);
        const customPortal = getCustomPortals().find(
          (portal) => portal.id === customPortalId && portal.tenantId === tenantId
        );
        if (!customPortal) return;
        this.createTenantCustomView(tenantId, tabId, customPortal.url);
      } else {
        this.createTenantPortalView(tenantId, tabId);
      }
    }

    const view = this.views.get(key);
    if (view) {
      view.setBounds(this.currentBounds);
      view.setVisible(true);
      view.webContents.focus();
      this.activeViewKey = key;
      this.lastUsed.set(key, Date.now());
      this.sendNavState();
      this.evictInactiveViews();
    }
  }

  selectTool(toolId: string): void {
    const key = makeToolViewKey(toolId);

    if (this.activeViewKey && this.activeViewKey !== key) {
      const current = this.views.get(this.activeViewKey);
      if (current) {
        current.setVisible(false);
      }
    }

    if (!this.views.has(key)) {
      const tool = getTools().find((t) => t.id === toolId);
      if (!tool) return;
      this.createToolView(tool.id, tool.url);
    }

    const view = this.views.get(key);
    if (view) {
      view.setBounds(this.currentBounds);
      view.setVisible(true);
      view.webContents.focus();
      this.activeViewKey = key;
      this.lastUsed.set(key, Date.now());
      this.sendNavState();
      this.evictInactiveViews();
    }
  }

  // --- Keeper Vault ---

  openKeeperVault(): void {
    const partition = 'persist:keeper-vault';
    configureRemoteSession(session.fromPartition(partition), () => this.mainWindow);
    const popup = new BrowserWindow({
      parent: this.mainWindow,
      width: 420,
      height: 620,
      resizable: true,
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        navigateOnDragDrop: false,
      },
    });
    popup.setMenuBarVisibility(false);
    popup.setContentProtection(getPreferences().contentProtection);
    hardenRemoteWebContents(popup.webContents);
    void popup.loadURL('https://keepersecurity.com/vault/').catch(() => {
      if (!popup.isDestroyed()) popup.close();
    });
  }

  // --- Navigation ---

  goBack(): void {
    const wc = this.getActiveWebContents();
    if (wc?.canGoBack()) wc.goBack();
  }

  goForward(): void {
    const wc = this.getActiveWebContents();
    if (wc?.canGoForward()) wc.goForward();
  }

  reload(): void {
    this.getActiveWebContents()?.reload();
  }

  navigateTo(url: string): boolean {
    const wc = this.getActiveWebContents();
    if (!wc) return false;
    let safeUrl: string;
    try {
      safeUrl = normalizeHttpsUrl(url);
    } catch {
      return false;
    }
    void wc.loadURL(safeUrl).catch(() => undefined);
    return true;
  }

  // --- Bounds ---

  updateBounds(bounds: ContentBounds): void {
    this.currentBounds = bounds;
    for (const view of this.views.values()) {
      view.setBounds(bounds);
    }
  }

  // --- Cleanup ---

  destroyTenantViews(tenantId: string): void {
    const tenantPrefix = `${tenantId}:`;
    for (const [key, view] of Array.from(this.views.entries())) {
      if (key.startsWith(tenantPrefix)) {
        this.destroyView(key, view);
      }
    }
  }

  destroyToolView(toolId: string): void {
    const key = makeToolViewKey(toolId);
    const view = this.views.get(key);
    if (view) {
      this.destroyView(key, view);
    }
  }

  destroyCustomPortalViews(customPortalId: string): void {
    const keySuffix = `:${makeCustomPortalTabId(customPortalId)}`;
    for (const [key, view] of Array.from(this.views.entries())) {
      if (key.endsWith(keySuffix)) {
        this.destroyView(key, view);
      }
    }
  }

  async clearTenantSession(tenantId: string): Promise<void> {
    this.destroyTenantViews(tenantId);
    await clearTenantPartition(tenantId);
  }

  destroyAll(): void {
    if (this.mainWindow.isDestroyed()) {
      this.views.clear();
      this.lastUsed.clear();
      this.activeViewKey = null;
      return;
    }
    for (const [key, view] of Array.from(this.views.entries())) {
      this.destroyView(key, view);
    }
    this.lastUsed.clear();
    this.activeViewKey = null;
  }

  dispose(): void {
    clearInterval(this.evictionTimer);
    this.destroyAll();
  }

  applyPreferences(): void {
    this.evictInactiveViews();
  }

  getLiveViewCount(): number {
    return this.views.size;
  }

  // --- Private ---

  private getActiveWebContents() {
    if (!this.activeViewKey) return null;
    return this.views.get(this.activeViewKey)?.webContents ?? null;
  }

  private destroyView(key: ViewKey, view: WebContentsView): void {
    if (this.activeViewKey === key) {
      this.activeViewKey = null;
    }
    view.setVisible(false);
    this.mainWindow.contentView.removeChildView(view);
    view.webContents.close();
    this.views.delete(key);
    this.lastUsed.delete(key);
  }

  private evictInactiveViews(): void {
    const preferences = getPreferences();
    const now = Date.now();
    const inactiveThreshold = preferences.inactiveViewMinutes * 60_000;

    for (const [key, view] of Array.from(this.views.entries())) {
      if (key === this.activeViewKey) continue;
      const lastUsed = this.lastUsed.get(key) ?? now;
      if (now - lastUsed >= inactiveThreshold) {
        this.destroyView(key, view);
      }
    }

    const hiddenByAge = Array.from(this.views.entries())
      .filter(([key]) => key !== this.activeViewKey)
      .sort(
        ([leftKey], [rightKey]) =>
          (this.lastUsed.get(leftKey) ?? 0) - (this.lastUsed.get(rightKey) ?? 0),
      );
    while (this.views.size > preferences.maxLiveViews && hiddenByAge.length > 0) {
      const [key, view] = hiddenByAge.shift()!;
      this.destroyView(key, view);
    }
  }

  private sendNavState(): void {
    const wc = this.getActiveWebContents();
    const state: NavState = {
      canGoBack: wc?.canGoBack() ?? false,
      canGoForward: wc?.canGoForward() ?? false,
      isLoading: wc?.isLoading() ?? false,
      url: wc?.getURL() ?? '',
    };
    this.mainWindow.webContents.send(IPC_CHANNELS.NAV_STATE, state);
  }

  private setupNavEvents(view: WebContentsView): void {
    const wc = view.webContents;
    const update = () => {
      const key = [...this.views.entries()].find(([, v]) => v === view)?.[0];
      if (key === this.activeViewKey) {
        this.sendNavState();
      }
    };
    wc.on('did-start-loading', update);
    wc.on('did-stop-loading', update);
    wc.on('did-navigate', update);
    wc.on('did-navigate-in-page', update);
  }

  private setupZoom(view: WebContentsView): void {
    const wc = view.webContents;
    void wc.setVisualZoomLevelLimits(1, 5);

    wc.on('before-input-event', (event, input) => {
      if (!input.control || input.type !== 'keyDown') return;
      if (input.key.toLowerCase() === 'n') {
        event.preventDefault();
        this.onNewWindow();
      } else if (input.key === '=' || input.key === '+') {
        event.preventDefault();
        wc.setZoomLevel(wc.getZoomLevel() + 0.5);
      } else if (input.key === '-') {
        event.preventDefault();
        wc.setZoomLevel(wc.getZoomLevel() - 0.5);
      } else if (input.key === '0') {
        event.preventDefault();
        wc.setZoomLevel(0);
      }
    });
  }

  private setupContextMenu(view: WebContentsView): void {
    const wc = view.webContents;
    installEditingContextMenu(wc, {
      window: this.mainWindow,
      additionalItems: () => {
        const url = wc.getURL();
        return [
          { label: 'Back', enabled: wc.canGoBack(), click: () => wc.goBack() },
          { label: 'Forward', enabled: wc.canGoForward(), click: () => wc.goForward() },
          { type: 'separator' },
          { label: 'Reload', click: () => wc.reload() },
          { type: 'separator' },
          { label: 'Copy URL', click: () => clipboard.writeText(url) },
          {
            label: 'Open in External Browser',
            enabled: url.startsWith('https://'),
            click: () => void openExternalHttps(url).catch(() => undefined),
          },
          { type: 'separator' },
          { label: 'Keeper Vault', click: () => this.openKeeperVault() },
        ];
      },
    });
  }

  private createTenantPortalView(tenantId: string, portalId: PortalId): void {
    const partition = tenantPartition(tenantId);
    const key = makeTenantTabViewKey(tenantId, portalId);
    if (this.views.has(key)) return;

    const view = this.createRemoteView(partition);
    this.views.set(key, view);
    void view.webContents
      .loadURL(PORTALS[portalId].url)
      .catch(() => undefined);
  }

  private createTenantCustomView(tenantId: string, tabId: CustomPortalTabId, url: string): void {
    const key = makeTenantTabViewKey(tenantId, tabId);
    if (this.views.has(key)) return;

    const portalId = getCustomPortalId(tabId);
    const safeUrl = normalizeHttpsUrl(url, 'Custom portal URL');
    const partition = customPortalPartition(tenantId, portalId, safeUrl);
    const view = this.createRemoteView(partition);
    this.views.set(key, view);
    void view.webContents.loadURL(safeUrl).catch(() => undefined);
  }

  private createToolView(toolId: string, url: string): void {
    const key = makeToolViewKey(toolId);
    if (this.views.has(key)) return;

    const safeUrl = normalizeHttpsUrl(url, 'Tool URL');
    const view = this.createRemoteView(toolPartition(toolId));
    this.views.set(key, view);
    void view.webContents.loadURL(safeUrl).catch(() => undefined);
  }

  private createRemoteView(partition: string): WebContentsView {
    configureRemoteSession(session.fromPartition(partition), () => this.mainWindow);
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webviewTag: false,
        navigateOnDragDrop: false,
      },
    });

    hardenRemoteWebContents(view.webContents);
    view.setVisible(false);
    view.setBounds(this.currentBounds);
    this.mainWindow.contentView.addChildView(view);
    this.setupZoom(view);
    this.setupNavEvents(view);
    this.setupContextMenu(view);
    return view;
  }
}
