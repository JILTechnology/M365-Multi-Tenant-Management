import { PORTALS, PORTAL_IDS } from '../../types/index';
import type { PortalId } from '../../types/index';

interface TabBarProps {
  activePortalId: PortalId;
  onSelectPortal: (portalId: PortalId) => void;
}

export default function TabBar({ activePortalId, onSelectPortal }: TabBarProps) {
  return (
    <div className="tab-bar">
      {PORTAL_IDS.map((portalId) => (
        <button
          key={portalId}
          className={`tab-item ${portalId === activePortalId ? 'active' : ''}`}
          onClick={() => onSelectPortal(portalId)}
        >
          {PORTALS[portalId].label}
        </button>
      ))}
    </div>
  );
}
