import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import NavBar from './components/NavBar';
import { PORTAL_IDS } from '../types/index';
import type { Tenant, ToolSite, PortalId, NavState } from '../types/index';
import './App.css';

const EMPTY_NAV: NavState = { canGoBack: false, canGoForward: false, isLoading: false, url: '' };

function App() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [tools, setTools] = useState<ToolSite[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [activeToolId, setActiveToolId] = useState<string | null>(null);
  const [activePortalId, setActivePortalId] = useState<PortalId>('admin');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [navState, setNavState] = useState<NavState>(EMPTY_NAV);
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

  useEffect(() => {
    refreshTenants();
    refreshTools();
  }, [refreshTenants, refreshTools]);

  useEffect(() => {
    const cleanup = window.electronAPI.onNavState(setNavState);
    return cleanup;
  }, []);

  const sendBounds = useCallback(() => {
    if (!contentRef.current) return;
    const rect = contentRef.current.getBoundingClientRect();
    window.electronAPI.updateLayout({
      x: Math.round(rect.x),
      y: Math.round(rect.y),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    });
  }, []);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const observer = new ResizeObserver(sendBounds);
    observer.observe(el);
    sendBounds();
    return () => observer.disconnect();
  }, [sendBounds]);

  const handleSelectTenant = useCallback((tenantId: string) => {
    setActiveTenantId(tenantId);
    setActiveToolId(null);
    setActivePortalId('admin');
    requestAnimationFrame(() => {
      window.electronAPI.selectTenant(tenantId, 'admin');
    });
  }, []);

  const handleSelectTool = useCallback((toolId: string) => {
    setActiveToolId(toolId);
    setActiveTenantId(null);
    requestAnimationFrame(() => {
      window.electronAPI.selectTool(toolId);
    });
  }, []);

  const handleSelectPortal = useCallback((portalId: PortalId) => {
    if (!activeTenantId) return;
    setActivePortalId(portalId);
    window.electronAPI.selectTenant(activeTenantId, portalId);
  }, [activeTenantId]);

  // Keyboard shortcuts: Ctrl+1-8 for portal tabs, Ctrl+Tab / Ctrl+Shift+Tab for tenant cycling
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!e.ctrlKey) return;

      // Ctrl+1 through Ctrl+8 — switch portal tab
      const digit = parseInt(e.key, 10);
      if (digit >= 1 && digit <= 8) {
        const index = digit - 1;
        if (activeTenantId && index < PORTAL_IDS.length) {
          e.preventDefault();
          handleSelectPortal(PORTAL_IDS[index]);
        }
        return;
      }

      // Ctrl+Tab / Ctrl+Shift+Tab — cycle tenants
      if (e.key === 'Tab' && tenants.length > 0) {
        e.preventDefault();
        const currentIndex = tenants.findIndex((t) => t.id === activeTenantId);
        let nextIndex: number;
        if (e.shiftKey) {
          // Previous tenant
          nextIndex = currentIndex <= 0 ? tenants.length - 1 : currentIndex - 1;
        } else {
          // Next tenant
          nextIndex = currentIndex >= tenants.length - 1 ? 0 : currentIndex + 1;
        }
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
  }, [refreshTenants]);

  const handleClearSession = useCallback(async (id: string) => {
    await window.electronAPI.clearTenantSession(id);
  }, []);

  const handleRemoveTenant = useCallback(async (id: string) => {
    await window.electronAPI.removeTenant(id);
    const list = await refreshTenants();
    if (activeTenantId === id) {
      if (list.length > 0) {
        handleSelectTenant(list[0].id);
      } else {
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

  const handleRemoveTool = useCallback(async (id: string) => {
    await window.electronAPI.removeTool(id);
    await refreshTools();
    if (activeToolId === id) {
      setActiveToolId(null);
      setNavState(EMPTY_NAV);
    }
  }, [activeToolId, refreshTools]);

  const hasActiveView = activeTenantId || activeToolId;

  return (
    <div className="app">
      <Sidebar
        tenants={tenants}
        tools={tools}
        activeTenantId={activeTenantId}
        activeToolId={activeToolId}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed((c) => !c)}
        onSelectTenant={handleSelectTenant}
        onSelectTool={handleSelectTool}
        onAddTenant={handleAddTenant}
        onUpdateTenant={handleUpdateTenant}
        onRemoveTenant={handleRemoveTenant}
        onClearSession={handleClearSession}
        onAddTool={handleAddTool}
        onRemoveTool={handleRemoveTool}
      />
      <div className="main-area">
        {activeTenantId ? (
          <TabBar
            activePortalId={activePortalId}
            onSelectPortal={handleSelectPortal}
          />
        ) : null}
        {hasActiveView ? <NavBar navState={navState} /> : null}
        <div className="content-area" ref={contentRef}>
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
  );
}

export default App;
