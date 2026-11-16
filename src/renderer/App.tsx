import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import NavBar from './components/NavBar';
import SettingsDialog from './components/SettingsDialog';
import BackupPasswordDialog from './components/BackupPasswordDialog';
import ExchangeTerminal from './components/ExchangeTerminal';
import {
  PORTAL_IDS,
  getCustomPortalId,
  isCustomPortalTabId,
  makeCustomPortalTabId,
} from '../types/index';
import type {
  AppPreferences,
  CustomPortalMoveDirection,
  CustomPortalSite,
  Tenant,
  TenantLastTabs,
  ToolSite,
  PortalId,
  NavState,
  TenantTabId,
} from '../types/index';
import { getTenantColor } from './tenant-identity';
import './App.css';

const EMPTY_NAV: NavState = {
  canGoBack: false,
  canGoForward: false,
  isLoading: false,
  url: '',
};

const DEFAULT_PREFERENCES: AppPreferences = {
  contentProtection: false,
  hideOnLock: true,
  inactiveViewMinutes: 15,
  maxLiveViews: 8,
  claudeControl: false,
};

function resolveTenantTab(
  tenantId: string,
  lastTabs: TenantLastTabs,
  customPortals: CustomPortalSite[],
): TenantTabId {
  const tabId = lastTabs[tenantId];
  if (!tabId) return 'admin';

  if (isCustomPortalTabId(tabId)) {
    const customPortalId = getCustomPortalId(tabId);
    const customPortalExists = customPortals.some(
      (portal) => portal.id === customPortalId && portal.tenantId === tenantId,
    );
    return customPortalExists ? tabId : 'admin';
  }

  return PORTAL_IDS.includes(tabId) ? tabId : 'admin';
}

function App() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [customPortals, setCustomPortals] = useState<CustomPortalSite[]>([]);
  const [tenantLastTabs, setTenantLastTabs] = useState<TenantLastTabs>({});
  const [tools, setTools] = useState<ToolSite[]>([]);
  const [preferences, setPreferences] = useState<AppPreferences>(DEFAULT_PREFERENCES);
  const [appVersion, setAppVersion] = useState('');
  const [claudeControlActive, setClaudeControlActive] = useState(false);
  const [exchangeTenantIds, setExchangeTenantIds] = useState<string[]>([]);
  const [terminalActive, setTerminalActive] = useState(false);
  const hideViewsRef = useRef(false);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [activeTenantTabId, setActiveTenantTabId] = useState<TenantTabId>('admin');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navState, setNavState] = useState<NavState>(EMPTY_NAV);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [backupDialogOpen, setBackupDialogOpen] = useState(false);
  const [backupError, setBackupError] = useState('');
  const [restorePasswordOpen, setRestorePasswordOpen] = useState(false);
  const [restorePasswordError, setRestorePasswordError] = useState('');
  const contentRef = useRef<HTMLDivElement>(null);

  const refreshTenants = useCallback(async () => {
    const list = await window.electronAPI.getTenants();
    setTenants(list);
    return list;
  }, []);

  const refreshTools = useCallback(async () => {
    const list = await window.electronAPI.getTools();
    setTools(list);
    return list;
  }, []);

  const refreshCustomPortals = useCallback(async () => {
    const list = await window.electronAPI.getCustomPortals();
    setCustomPortals(list);
    return list;
  }, []);

  const refreshTenantLastTabs = useCallback(async () => {
    const map = await window.electronAPI.getTenantLastTabs();
    setTenantLastTabs(map);
    return map;
  }, []);

  const refreshPreferences = useCallback(async () => {
    const value = await window.electronAPI.getPreferences();
    setPreferences(value);
    return value;
  }, []);

  useEffect(() => {
    void refreshTenants();
    void refreshCustomPortals();
    void refreshTenantLastTabs();
    void refreshTools();
    void refreshPreferences();
    void window.electronAPI.getAppVersion().then(setAppVersion);
    void window.electronAPI.isClaudeControlActive().then(setClaudeControlActive);
    void window.electronAPI.getExchangePowerShellTenantIds().then(setExchangeTenantIds);
  }, [
    refreshTenants,
    refreshCustomPortals,
    refreshTenantLastTabs,
    refreshTools,
    refreshPreferences,
  ]);

  useEffect(() => window.electronAPI.onNavState(setNavState), []);

  useEffect(() => window.electronAPI.onDataChanged((notice) => {
    void (async () => {
      if (notice.scope === 'preferences') {
        await refreshPreferences();
        return;
      }
      if (notice.scope === 'tenantLastTabs') {
        await refreshTenantLastTabs();
        return;
      }
      if (notice.scope === 'tenants') {
        const list = await refreshTenants();
        if (activeTenantId && list.some((tenant) => tenant.id === activeTenantId)) {
          window.electronAPI.selectTenant(activeTenantId, activeTenantTabId);
        }
        return;
      }
      if (notice.scope === 'customPortals') {
        const list = await refreshCustomPortals();
        await refreshTenantLastTabs();
        if (activeTenantId) {
          const tabId = isCustomPortalTabId(activeTenantTabId) && !list.some(
            (portal) =>
              portal.id === getCustomPortalId(activeTenantTabId) &&
              portal.tenantId === activeTenantId,
          )
            ? 'admin'
            : activeTenantTabId;
          setActiveTenantTabId(tabId);
          window.electronAPI.selectTenant(activeTenantId, tabId);
        }
        return;
      }
      if (notice.scope === 'tools') {
        const list = await refreshTools();
        if (activeToolId && list.some((tool) => tool.id === activeToolId)) {
          window.electronAPI.selectTool(activeToolId);
        }
        return;
      }
      if (notice.scope === 'all') {
        const [tenantList, portalList, lastTabs, toolList] = await Promise.all([
          refreshTenants(),
          refreshCustomPortals(),
          refreshTenantLastTabs(),
          refreshTools(),
          refreshPreferences(),
        ]);
        if (activeTenantId && tenantList.some((tenant) => tenant.id === activeTenantId)) {
          const tabId = resolveTenantTab(activeTenantId, lastTabs, portalList);
          setActiveTenantTabId(tabId);
          window.electronAPI.selectTenant(activeTenantId, tabId);
        } else if (activeToolId && toolList.some((tool) => tool.id === activeToolId)) {
          window.electronAPI.selectTool(activeToolId);
        }
      }
    })().catch(() => undefined);
  }), [
    activeTenantId,
    activeTenantTabId,
    activeToolId,
    refreshCustomPortals,
    refreshPreferences,
    refreshTenantLastTabs,
    refreshTenants,
    refreshTools,
  ]);

  useEffect(() => {
    if (activeTenantId && !tenants.some((tenant) => tenant.id === activeTenantId)) {
      setActiveTenantId(null);
      setNavState(EMPTY_NAV);
    }
  }, [activeTenantId, tenants]);

  useEffect(() => {
    if (activeToolId && !tools.some((tool) => tool.id === activeToolId)) {
      setActiveToolId(null);
      setNavState(EMPTY_NAV);
    }
  }, [activeToolId, tools]);

  const sendBounds = useCallback(() => {
    if (!contentRef.current) return;
    // Portal pages are native views drawn over the window; collapse them while a
    // dialog or the PowerShell tab needs the content area.
    if (hideViewsRef.current) {
      window.electronAPI.updateLayout({ x: 0, y: 0, width: 0, height: 0 });
      return;
    }
    const rect = contentRef.current.getBoundingClientRect();
    window.electronAPI.updateLayout({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }, []);

  useEffect(() => {
    const element = contentRef.current;
    if (!element) return;
    const observer = new ResizeObserver(sendBounds);
    observer.observe(element);
    sendBounds();
    return () => observer.disconnect();
  }, [sendBounds]);

  const modalOpen = settingsOpen || backupDialogOpen || restorePasswordOpen;
  const terminalShown = Boolean(
    terminalActive && activeTenantId && exchangeTenantIds.includes(activeTenantId),
  );
  const hideViews = modalOpen || terminalShown;
  useEffect(() => {
    hideViewsRef.current = hideViews;
    requestAnimationFrame(sendBounds);
  }, [hideViews, sendBounds]);

  const handleSelectTenant = useCallback((tenantId: string) => {
    const tabId = resolveTenantTab(tenantId, tenantLastTabs, customPortals);
    setActiveTenantId(tenantId);
    setActiveToolId(null);
    setActiveTenantTabId(tabId);
    setTerminalActive(false);
    void window.electronAPI.getExchangePowerShellTenantIds().then(setExchangeTenantIds);
    requestAnimationFrame(() => window.electronAPI.selectTenant(tenantId, tabId));
  }, [customPortals, tenantLastTabs]);

  const handleSelectTool = useCallback((toolId: string) => {
    setActiveToolId(toolId);
    setActiveTenantId(null);
    setTerminalActive(false);
    requestAnimationFrame(() => window.electronAPI.selectTool(toolId));
  }, []);

  const handleSelectPortal = useCallback((portalId: PortalId) => {
    if (!activeTenantId) return;
    setTerminalActive(false);
    setActiveTenantTabId(portalId);
    setTenantLastTabs((current) => ({ ...current, [activeTenantId]: portalId }));
    void window.electronAPI.setTenantLastTab(activeTenantId, portalId);
    window.electronAPI.selectTenant(activeTenantId, portalId);
  }, [activeTenantId]);

  const handleSelectTenantTab = useCallback((tabId: TenantTabId) => {
    if (!activeTenantId) return;
    setTerminalActive(false);
    setActiveTenantTabId(tabId);
    setTenantLastTabs((current) => ({ ...current, [activeTenantId]: tabId }));
    void window.electronAPI.setTenantLastTab(activeTenantId, tabId);
    window.electronAPI.selectTenant(activeTenantId, tabId);
  }, [activeTenantId]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return;
      const digit = Number.parseInt(event.key, 10);
      if (digit >= 1 && digit <= 9) {
        const index = digit - 1;
        if (activeTenantId && index < PORTAL_IDS.length) {
          event.preventDefault();
          handleSelectPortal(PORTAL_IDS[index]);
        }
        return;
      }

      if (event.key === 'Tab' && tenants.length > 0) {
        event.preventDefault();
        const currentIndex = tenants.findIndex((tenant) => tenant.id === activeTenantId);
        const nextIndex = event.shiftKey
          ? currentIndex <= 0 ? tenants.length - 1 : currentIndex - 1
          : currentIndex >= tenants.length - 1 ? 0 : currentIndex + 1;
        handleSelectTenant(tenants[nextIndex].id);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [activeTenantId, tenants, handleSelectPortal, handleSelectTenant]);

  const handleAddTenant = useCallback(async (name: string, domain: string) => {
    const tenant = await window.electronAPI.addTenant({ name, domain });
    await refreshTenants();
    handleSelectTenant(tenant.id);
  }, [refreshTenants, handleSelectTenant]);

  const handleUpdateTenant = useCallback(async (id: string, name: string, domain: string) => {
    await window.electronAPI.updateTenant(id, { name, domain });
    await refreshTenants();
    if (activeTenantId === id) window.electronAPI.selectTenant(id, activeTenantTabId);
  }, [activeTenantId, activeTenantTabId, refreshTenants]);

  const handleClearSession = useCallback(async (id: string) => {
    const cleared = await window.electronAPI.clearTenantSession(id);
    if (cleared && activeTenantId === id) {
      window.electronAPI.selectTenant(id, activeTenantTabId);
    }
  }, [activeTenantId, activeTenantTabId]);

  const handleRemoveTenant = useCallback(async (id: string) => {
    const removed = await window.electronAPI.removeTenant(id);
    if (!removed) return;
    const list = await refreshTenants();
    if (activeTenantId === id) {
      if (list.length > 0) handleSelectTenant(list[0].id);
      else {
        setActiveTenantId(null);
        setNavState(EMPTY_NAV);
      }
    }
  }, [activeTenantId, refreshTenants, handleSelectTenant]);

  const handleAddTool = useCallback(async (label: string, url: string) => {
    const tool = await window.electronAPI.addTool({ label, url });
    await refreshTools();
    handleSelectTool(tool.id);
  }, [refreshTools, handleSelectTool]);

  const handleAddCustomPortal = useCallback(async (label: string, url: string) => {
    if (!activeTenantId) throw new Error('No active tenant selected');
    const portal = await window.electronAPI.addCustomPortal({
      tenantId: activeTenantId,
      label,
      url,
    });
    await refreshCustomPortals();
    const tabId = makeCustomPortalTabId(portal.id);
    setTerminalActive(false);
    setActiveTenantTabId(tabId);
    setTenantLastTabs((current) => ({ ...current, [activeTenantId]: tabId }));
    void window.electronAPI.setTenantLastTab(activeTenantId, tabId);
    window.electronAPI.selectTenant(activeTenantId, tabId);
  }, [activeTenantId, refreshCustomPortals]);

  const handleUpdateCustomPortal = useCallback(async (id: string, label: string, url: string) => {
    await window.electronAPI.updateCustomPortal(id, { label, url });
    await refreshCustomPortals();
    if (activeTenantId && activeTenantTabId === makeCustomPortalTabId(id)) {
      window.electronAPI.selectTenant(activeTenantId, activeTenantTabId);
    }
  }, [activeTenantId, activeTenantTabId, refreshCustomPortals]);

  const handleMoveCustomPortal = useCallback(async (
    id: string,
    direction: CustomPortalMoveDirection,
  ) => {
    setCustomPortals(await window.electronAPI.moveCustomPortal(id, direction));
  }, []);

  const handleRemoveCustomPortal = useCallback(async (id: string) => {
    const removedTabId = makeCustomPortalTabId(id);
    await window.electronAPI.removeCustomPortal(id);
    await refreshCustomPortals();
    await refreshTenantLastTabs();
    if (activeTenantId && activeTenantTabId === removedTabId) {
      setActiveTenantTabId('admin');
      setTenantLastTabs((current) => ({ ...current, [activeTenantId]: 'admin' }));
      void window.electronAPI.setTenantLastTab(activeTenantId, 'admin');
      window.electronAPI.selectTenant(activeTenantId, 'admin');
    }
  }, [activeTenantId, activeTenantTabId, refreshCustomPortals, refreshTenantLastTabs]);

  const handleRemoveTool = useCallback(async (id: string) => {
    await window.electronAPI.removeTool(id);
    await refreshTools();
    if (activeToolId === id) {
      setActiveToolId(null);
      setNavState(EMPTY_NAV);
    }
  }, [activeToolId, refreshTools]);

  const openBackupDialog = useCallback(() => {
    setSettingsOpen(false);
    setBackupError('');
    setBackupDialogOpen(true);
  }, []);

  const handleBackupSubmit = useCallback(async (encrypted: boolean, passphrase?: string) => {
    setBackupError('');
    try {
      const result = await window.electronAPI.backupData({ encrypted, passphrase });
      if (result.ok) {
        setBackupDialogOpen(false);
        alert(`${result.message}\n${result.path ?? ''}`);
      } else if (result.message !== 'Backup canceled.') {
        setBackupError(result.message);
      }
    } catch (error) {
      setBackupError(error instanceof Error ? error.message : 'Backup failed.');
    }
  }, []);

  const handleRestoreData = useCallback(async () => {
    setSettingsOpen(false);
    setRestorePasswordError('');
    try {
      const result = await window.electronAPI.restoreData();
      if (result.requiresPassphrase) {
        setRestorePasswordOpen(true);
      } else if (result.ok) {
        alert(result.message);
        window.location.reload();
      } else if (result.message !== 'Restore canceled.') {
        alert(result.message);
      }
    } catch (error) {
      alert(error instanceof Error ? error.message : 'Restore failed.');
    }
  }, []);

  const handleRestorePassword = useCallback(async (_encrypted: boolean, passphrase?: string) => {
    setRestorePasswordError('');
    try {
      const result = await window.electronAPI.restoreData({ passphrase });
      if (result.requiresPassphrase) {
        setRestorePasswordError(result.message);
      } else if (result.ok) {
        setRestorePasswordOpen(false);
        alert(result.message);
        window.location.reload();
      } else {
        setRestorePasswordOpen(false);
        if (result.message !== 'Restore canceled.') alert(result.message);
      }
    } catch (error) {
      setRestorePasswordError(error instanceof Error ? error.message : 'Restore failed.');
    }
  }, []);

  const handleSavePreferences = useCallback(async (value: AppPreferences) => {
    setPreferences(await window.electronAPI.updatePreferences(value));
  }, []);

  const activeTenant = tenants.find((tenant) => tenant.id === activeTenantId) ?? null;
  const activeTool = tools.find((tool) => tool.id === activeToolId) ?? null;
  const hasActiveView = Boolean(activeTenant || activeTool);
  const activeTenantCustomPortals = activeTenant
    ? customPortals.filter((portal) => portal.tenantId === activeTenant.id)
    : [];

  return (
    <>
      <div className="app">
        <Sidebar
          tenants={tenants}
          tools={tools}
          activeTenantId={activeTenantId}
          activeToolId={activeToolId}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((collapsed) => !collapsed)}
          onSelectTenant={handleSelectTenant}
          onSelectTool={handleSelectTool}
          onAddTenant={handleAddTenant}
          onUpdateTenant={handleUpdateTenant}
          onRemoveTenant={handleRemoveTenant}
          onClearSession={handleClearSession}
          onAddTool={handleAddTool}
          onRemoveTool={handleRemoveTool}
          onBackupData={openBackupDialog}
          onRestoreData={handleRestoreData}
          onOpenSettings={() => setSettingsOpen(true)}
        />
        <div className="main-area">
          {claudeControlActive && (
            <div className="claude-control-banner" role="status">
              Claude control is on: programs on this PC can operate every signed-in portal.
              Turn it off in Settings when you are done.
            </div>
          )}
          {activeTenant && (
            <div
              className="active-context tenant-context"
              style={{ borderLeftColor: getTenantColor(activeTenant.id) }}
            >
              <span
                className="active-context-dot"
                style={{ backgroundColor: getTenantColor(activeTenant.id) }}
              />
              <span className="active-context-type">Active Tenant</span>
              <strong>{activeTenant.name}</strong>
              <span className="active-context-detail">{activeTenant.domain}</span>
            </div>
          )}
          {activeTool && (
            <div className="active-context tool-context">
              <span className="active-context-dot" />
              <span className="active-context-type">Tool</span>
              <strong>{activeTool.label}</strong>
              <span className="active-context-detail">{new URL(activeTool.url).hostname}</span>
            </div>
          )}
          {activeTenant ? (
            <TabBar
              activeTabId={activeTenantTabId}
              customPortals={activeTenantCustomPortals}
              onSelectTab={handleSelectTenantTab}
              exchangeTab={exchangeTenantIds.includes(activeTenant.id) ? {
                active: terminalShown,
                onSelect: () => setTerminalActive(true),
              } : undefined}
              onAddCustomPortal={handleAddCustomPortal}
              onUpdateCustomPortal={handleUpdateCustomPortal}
              onMoveCustomPortal={handleMoveCustomPortal}
              onRemoveCustomPortal={handleRemoveCustomPortal}
            />
          ) : null}
          {hasActiveView && !terminalShown ? <NavBar navState={navState} /> : null}
          <div className="content-area" ref={contentRef}>
            {terminalShown && activeTenant && <ExchangeTerminal tenantId={activeTenant.id} />}
            {!hasActiveView && (
              <div className="content-placeholder">
                <p>
                  {tenants.length === 0
                    ? 'Add a tenant to get started.'
                    : 'Select a tenant or tool from the sidebar.'}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>

      <SettingsDialog
        open={settingsOpen}
        appVersion={appVersion}
        claudeControlActive={claudeControlActive}
        preferences={preferences}
        onClose={() => setSettingsOpen(false)}
        onSave={handleSavePreferences}
        onBackup={openBackupDialog}
        onRestore={() => void handleRestoreData()}
      />
      <BackupPasswordDialog
        mode="backup"
        open={backupDialogOpen}
        externalError={backupError}
        onCancel={() => setBackupDialogOpen(false)}
        onSubmit={handleBackupSubmit}
      />
      <BackupPasswordDialog
        mode="restore"
        open={restorePasswordOpen}
        externalError={restorePasswordError}
        onCancel={() => setRestorePasswordOpen(false)}
        onSubmit={handleRestorePassword}
      />
    </>
  );
}

export default App;
