import { useState, type FormEvent } from 'react';
import { PORTALS, PORTAL_IDS, makeCustomPortalTabId } from '../../types/index';
import type { CustomPortalMoveDirection, CustomPortalSite, TenantTabId } from '../../types/index';

interface TabBarProps {
  activeTabId: TenantTabId;
  customPortals: CustomPortalSite[];
  onSelectTab: (tabId: TenantTabId) => void;
  onAddCustomPortal: (label: string, url: string) => void | Promise<void>;
  onUpdateCustomPortal: (id: string, label: string, url: string) => void | Promise<void>;
  onMoveCustomPortal: (id: string, direction: CustomPortalMoveDirection) => void | Promise<void>;
  onRemoveCustomPortal: (id: string) => void;
}

export default function TabBar({
  activeTabId,
  customPortals,
  onSelectTab,
  onAddCustomPortal,
  onUpdateCustomPortal,
  onMoveCustomPortal,
  onRemoveCustomPortal,
}: TabBarProps) {
  const [showAddForm, setShowAddForm] = useState(false);
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [editingPortalId, setEditingPortalId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editUrl, setEditUrl] = useState('');
  const [editError, setEditError] = useState('');

  const resetAddForm = () => {
    setLabel('');
    setUrl('');
    setError('');
    setShowAddForm(false);
  };

  const resetEditForm = () => {
    setEditingPortalId(null);
    setEditLabel('');
    setEditUrl('');
    setEditError('');
  };

  const beginEdit = (portal: CustomPortalSite) => {
    resetAddForm();
    setEditingPortalId(portal.id);
    setEditLabel(portal.label);
    setEditUrl(portal.url);
    setEditError('');
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const trimmedLabel = label.trim();
    const trimmedUrl = url.trim();
    if (!trimmedLabel || !trimmedUrl) return;
    setError('');

    try {
      await onAddCustomPortal(trimmedLabel, trimmedUrl);
      resetAddForm();
    } catch {
      setError('Enter a valid HTTPS URL.');
    }
  };

  const handleEditSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editingPortalId) return;

    const trimmedLabel = editLabel.trim();
    const trimmedUrl = editUrl.trim();
    if (!trimmedLabel || !trimmedUrl) return;
    setEditError('');

    try {
      await onUpdateCustomPortal(editingPortalId, trimmedLabel, trimmedUrl);
      resetEditForm();
    } catch {
      setEditError('Enter a valid HTTPS URL.');
    }
  };

  return (
    <div className="tab-bar">
      <div className="tab-row">
        <div className="tab-scroll">
          {PORTAL_IDS.map((portalId) => (
            <button
              key={portalId}
              className={`tab-item ${portalId === activeTabId ? 'active' : ''}`}
              onClick={() => onSelectTab(portalId)}
            >
              {PORTALS[portalId].label}
            </button>
          ))}
          {customPortals.map((portal, index) => {
            const tabId = makeCustomPortalTabId(portal.id);
            return (
              <div
                key={portal.id}
                className={`custom-tab-item ${tabId === activeTabId ? 'active' : ''}${portal.id === editingPortalId ? ' editing' : ''}`}
                title={portal.url}
              >
                <button
                  className="custom-tab-label"
                  onClick={() => onSelectTab(tabId)}
                >
                  {portal.label}
                </button>
                <div className="custom-tab-actions">
                  <button
                    className="custom-tab-action"
                    disabled={index === 0}
                    onClick={() => onMoveCustomPortal(portal.id, 'left')}
                    title={`Move ${portal.label} left`}
                  >
                    &lt;
                  </button>
                  <button
                    className="custom-tab-action"
                    disabled={index === customPortals.length - 1}
                    onClick={() => onMoveCustomPortal(portal.id, 'right')}
                    title={`Move ${portal.label} right`}
                  >
                    &gt;
                  </button>
                  <button
                    className="custom-tab-action"
                    onClick={() => beginEdit(portal)}
                    title={`Edit ${portal.label}`}
                  >
                    Edit
                  </button>
                  <button
                    className="custom-tab-action"
                    onClick={() => onRemoveCustomPortal(portal.id)}
                    title={`Remove ${portal.label}`}
                  >
                    &times;
                  </button>
                </div>
              </div>
            );
          })}
          <button
            className={`tab-add-btn ${showAddForm ? 'active' : ''}`}
            onClick={() => {
              resetEditForm();
              setShowAddForm((show) => !show);
            }}
            title="Add website tab"
          >
            +
          </button>
        </div>
      </div>
      {showAddForm && (
        <form className="tab-add-panel" onSubmit={handleSubmit}>
          <div className="tab-add-fields">
            <input
              autoFocus
              placeholder="Name"
              value={label}
              onChange={(event) => {
                setLabel(event.target.value);
                setError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') resetAddForm();
              }}
            />
            <input
              placeholder="HTTPS URL"
              value={url}
              onChange={(event) => {
                setUrl(event.target.value);
                setError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') resetAddForm();
              }}
            />
          </div>
          {error && <div className="tab-add-error">{error}</div>}
          <div className="tab-add-actions">
            <button
              className="tab-add-save"
              disabled={!label.trim() || !url.trim()}
              type="submit"
            >
              Add
            </button>
            <button
              className="tab-add-cancel"
              type="button"
              onClick={resetAddForm}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {editingPortalId && (
        <form className="tab-add-panel" onSubmit={handleEditSubmit}>
          <div className="tab-add-fields">
            <input
              autoFocus
              placeholder="Name"
              value={editLabel}
              onChange={(event) => {
                setEditLabel(event.target.value);
                setEditError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') resetEditForm();
              }}
            />
            <input
              placeholder="HTTPS URL"
              value={editUrl}
              onChange={(event) => {
                setEditUrl(event.target.value);
                setEditError('');
              }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') resetEditForm();
              }}
            />
          </div>
          {editError && <div className="tab-add-error">{editError}</div>}
          <div className="tab-add-actions">
            <button
              className="tab-add-save"
              disabled={!editLabel.trim() || !editUrl.trim()}
              type="submit"
            >
              Save
            </button>
            <button
              className="tab-add-cancel"
              type="button"
              onClick={resetEditForm}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
