import { BrowserWindow, WebContentsView } from 'electron';
import {
  type PortalId,
  type ViewKey,
  type ContentBounds,
  PORTALS,
  PORTAL_IDS,
  makeViewKey,
} from '../types/index';

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
      this.createTenantViews(tenantId);
    }

    // Show the requested view
    const view = this.views.get(key);
    if (view) {
      view.setBounds(this.currentBounds);
      view.setVisible(true);
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

  destroyAll(): void {
    for (const [key, view] of this.views) {
      this.mainWindow.contentView.removeChildView(view);
      view.webContents.close();
      this.views.delete(key);
    }
    this.activeViewKey = null;
  }

  private createTenantViews(tenantId: string): void {
    const partition = `persist:tenant-${tenantId}`;

    for (const portalId of PORTAL_IDS) {
      const key = makeViewKey(tenantId, portalId);
      if (this.views.has(key)) continue;

      const view = new WebContentsView({
        webPreferences: {
          partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });

      view.setVisible(false);
      view.setBounds(this.currentBounds);
      this.mainWindow.contentView.addChildView(view);
      view.webContents.loadURL(PORTALS[portalId].url);

      this.views.set(key, view);
    }
  }
}
