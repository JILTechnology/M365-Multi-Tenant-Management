import { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from './components/Sidebar';
import TabBar from './components/TabBar';
import type { Tenant, PortalId } from '../types/index';
import './App.css';

function App() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [activeTenantId, setActiveTenantId] = useState<string | null>(null);
  const [activePortalId, setActivePortalId] = useState<PortalId>('admin');
  const contentRef = useRef<HTMLDivElement>(null);

  // Load tenants on mount
  useEffect(() => {
    window.electronAPI.getTenants().then(setTenants);
  }, []);

  // Report content area bounds to main process via ResizeObserver
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
    sendBounds(); // Send initial bounds

    return () => observer.disconnect();
  }, [sendBounds]);

  const handleSelectTenant = useCallback((tenantId: string) => {
    setActiveTenantId(tenantId);
    setActivePortalId('admin');
    // Small delay to let React render and ResizeObserver fire first
    requestAnimationFrame(() => {
      window.electronAPI.selectTenant(tenantId, 'admin');
    });
  }, []);

  const handleSelectPortal = useCallback((portalId: PortalId) => {
    if (!activeTenantId) return;
    setActivePortalId(portalId);
    window.electronAPI.selectTenant(activeTenantId, portalId);
  }, [activeTenantId]);

  return (
    <div className="app">
      <Sidebar
        tenants={tenants}
        activeTenantId={activeTenantId}
        onSelectTenant={handleSelectTenant}
      />
      <div className="main-area">
        {activeTenantId ? (
          <TabBar
            activePortalId={activePortalId}
            onSelectPortal={handleSelectPortal}
          />
        ) : null}
        <div className="content-area" ref={contentRef}>
          {!activeTenantId && (
            <div className="content-placeholder">
              <p>Select a tenant from the sidebar to get started.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;
