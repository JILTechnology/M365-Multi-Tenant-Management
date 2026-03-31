import { BrowserWindow, WebContentsView } from 'electron';
import {
  type PortalId,
  type ViewKey,
  type ContentBounds,
  PORTAL_IDS,
  makeViewKey,
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
    }
  }

  updateBounds(bounds: ContentBounds): void {
    this.currentBounds = bounds;

    // Reposition all views (only visible one matters, but keep all in sync)
    for (const view of this.views.values()) {
      view.setBounds(bounds);
    }
  }

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
    for (const [key, view] of this.views) {
      this.mainWindow.contentView.removeChildView(view);
      view.webContents.close();
      this.views.delete(key);
    }
    this.activeViewKey = null;
  }

  private setupZoom(view: WebContentsView): void {
    const wc = view.webContents;

    // Enable pinch-to-zoom
    wc.setVisualZoomLevelLimits(1, 5);

    // Ctrl+scroll wheel zoom via injected handler — uses Electron zoom API
    // through a shared variable that the main process polls isn't feasible,
    // so we use a lightweight approach: inject script that communicates via
    // console message.
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

    // Listen for zoom console messages from the injected script
    wc.on('console-message', (_event, _level, message) => {
      if (message === '__zoom__:in') {
        wc.setZoomLevel(wc.getZoomLevel() + 0.5);
      } else if (message === '__zoom__:out') {
        wc.setZoomLevel(wc.getZoomLevel() - 0.5);
      }
    });

    // Ctrl+Plus/Minus/Zero keyboard zoom
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

      // Enable Ctrl+scroll zoom and Ctrl+/- keyboard zoom
      this.setupZoom(view);

      this.views.set(key, view);
    }
  }
}
