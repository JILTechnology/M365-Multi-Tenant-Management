import { BrowserWindow, WebContentsView } from 'electron';
import {
  type PortalId,
  type ViewKey,
  type ContentBounds,
  type NavState,
  IPC_CHANNELS,
  PORTAL_IDS,
  TOOL_SITES,
  makeViewKey,
  makeToolViewKey,
  resolvePortalUrl,
} from '../types/index';
import { getTenants } from './store';

export class TenantViewManager {
  private views = new Map<ViewKey, WebContentsView>();
  private activeViewKey: ViewKey | null = null;
  private currentBounds: ContentBounds = { x: 0, y: 0, width: 0, height: 0 };
  private mainWindow: BrowserWindow;

  constructor(mainWindow: BrowserWindow) {
    this.mainWindow = mainWindow;
  }

  selectView(tenantId: string, portalId: PortalId): void {
    const key = makeViewKey(tenantId, portalId);

    // Hide current view
    if (this.activeViewKey && this.activeViewKey !== key) {
      const current = this.views.get(this.activeViewKey);
      if (current) {
        current.setVisible(false);
      }
    }

    // Create all views for this tenant if they don't exist yet
    if (!this.views.has(key)) {
      const tenant = getTenants().find((t) => t.id === tenantId);
      const domain = tenant?.domain ?? '';
      this.createTenantViews(tenantId, domain);
    }

    // Show the requested view and give it focus so it receives input
    const view = this.views.get(key);
    if (view) {
      view.setBounds(this.currentBounds);
      view.setVisible(true);
      view.webContents.focus();
      this.activeViewKey = key;
      this.sendNavState();
    }
  }

  selectTool(toolId: string): void {
    const key = makeToolViewKey(toolId);

    // Hide current view
    if (this.activeViewKey && this.activeViewKey !== key) {
      const current = this.views.get(this.activeViewKey);
      if (current) {
        current.setVisible(false);
      }
    }

    // Create the tool view if it doesn't exist
    if (!this.views.has(key)) {
      const tool = TOOL_SITES.find((t) => t.id === toolId);
      if (!tool) return;
      this.createToolView(tool.id, tool.url);
    }

    const view = this.views.get(key);
    if (view) {
      view.setBounds(this.currentBounds);
      view.setVisible(true);
      view.webContents.focus();
      this.activeViewKey = key;
      this.sendNavState();
    }
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

  // --- Bounds ---

  updateBounds(bounds: ContentBounds): void {
    this.currentBounds = bounds;
    for (const view of this.views.values()) {
      view.setBounds(bounds);
    }
  }

  // --- Cleanup ---

  destroyTenantViews(tenantId: string): void {
    for (const portalId of PORTAL_IDS) {
      const key = makeViewKey(tenantId, portalId);
      const view = this.views.get(key);
      if (view) {
        if (this.activeViewKey === key) {
          this.activeViewKey = null;
        }
        view.setVisible(false);
        this.mainWindow.contentView.removeChildView(view);
        view.webContents.close();
        this.views.delete(key);
      }
    }
  }

  destroyAll(): void {
    if (this.mainWindow.isDestroyed()) {
      this.views.clear();
      this.activeViewKey = null;
      return;
    }
    for (const [key, view] of this.views) {
      this.mainWindow.contentView.removeChildView(view);
      view.webContents.close();
      this.views.delete(key);
    }
    this.activeViewKey = null;
  }

  // --- Private ---

  private getActiveWebContents() {
    if (!this.activeViewKey) return null;
    return this.views.get(this.activeViewKey)?.webContents ?? null;
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
      // Only send state if this view is the active one
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

    wc.setVisualZoomLevelLimits(1, 5);

    wc.on('dom-ready', () => {
      wc.executeJavaScript(`
        document.addEventListener('wheel', (e) => {
          if (e.ctrlKey) {
            e.preventDefault();
            console.log('__zoom__:' + (e.deltaY > 0 ? 'out' : 'in'));
          }
        }, { passive: false });
      `);
    });

    wc.on('console-message', (_event, _level, message) => {
      if (message === '__zoom__:in') {
        wc.setZoomLevel(wc.getZoomLevel() + 0.5);
      } else if (message === '__zoom__:out') {
        wc.setZoomLevel(wc.getZoomLevel() - 0.5);
      }
    });

    wc.on('before-input-event', (_event, input) => {
      if (!input.control || input.type !== 'keyDown') return;
      if (input.key === '=' || input.key === '+') {
        wc.setZoomLevel(wc.getZoomLevel() + 0.5);
      } else if (input.key === '-') {
        wc.setZoomLevel(wc.getZoomLevel() - 0.5);
      } else if (input.key === '0') {
        wc.setZoomLevel(0);
      }
    });
  }

  private createTenantViews(tenantId: string, domain: string): void {
    const partition = `persist:tenant-${tenantId}`;

    for (const portalId of PORTAL_IDS) {
      const key = makeViewKey(tenantId, portalId);
      if (this.views.has(key)) continue;

      const view = new WebContentsView({
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false,
        },
      });

      view.setVisible(false);
      view.setBounds(this.currentBounds);
      this.mainWindow.contentView.addChildView(view);
      view.webContents.loadURL(resolvePortalUrl(portalId, domain));

      this.setupZoom(view);
      this.setupNavEvents(view);

      this.views.set(key, view);
    }
  }

  private createToolView(toolId: string, url: string): void {
    const key = makeToolViewKey(toolId);
    if (this.views.has(key)) return;

    const view = new WebContentsView({
      webPreferences: {
        partition: `persist:tool-${toolId}`,
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    view.setVisible(false);
    view.setBounds(this.currentBounds);
    this.mainWindow.contentView.addChildView(view);
    view.webContents.loadURL(url);

    this.setupZoom(view);
    this.setupNavEvents(view);

    this.views.set(key, view);
  }
}
