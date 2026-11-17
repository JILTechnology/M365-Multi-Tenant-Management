import { useEffect, useRef, useState } from 'react';
import type { NavState } from '../../types/index';

interface NavBarProps {
  navState: NavState;
}

export default function NavBar({ navState }: NavBarProps) {
  const [editing, setEditing] = useState(false);
  const [inputValue, setInputValue] = useState('');
  const [invalid, setInvalid] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const displayUrl = navState.url === 'about:blank' ? '' : navState.url;

  useEffect(() => {
    if (!editing) return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  const startEditing = () => {
    setInputValue(displayUrl);
    setInvalid(false);
    setEditing(true);
  };

  const stopEditing = () => {
    setEditing(false);
    setInvalid(false);
  };

  const commitNavigation = async () => {
    const trimmed = inputValue.trim();
    if (!trimmed || trimmed === displayUrl) {
      stopEditing();
      return;
    }
    if (await window.electronAPI.navigateTo(trimmed)) {
      stopEditing();
    } else {
      setInvalid(true);
    }
  };

  return (
    <div className="nav-bar">
      <div className="nav-buttons">
        <button
          className="nav-btn"
          disabled={!navState.canGoBack}
          onClick={() => window.electronAPI.navBack()}
          title="Back"
        >
          &#8592;
        </button>
        <button
          className="nav-btn"
          disabled={!navState.canGoForward}
          onClick={() => window.electronAPI.navForward()}
          title="Forward"
        >
          &#8594;
        </button>
        <button
          className="nav-btn"
          onClick={() => window.electronAPI.navReload()}
          title="Reload"
        >
          {navState.isLoading ? '\u2715' : '\u21BB'}
        </button>
      </div>
      {editing ? (
        <input
          ref={inputRef}
          className={`nav-url-input${invalid ? ' invalid' : ''}`}
          value={inputValue}
          title={invalid ? 'Enter a valid HTTPS URL.' : undefined}
          onChange={(e) => {
            setInputValue(e.target.value);
            setInvalid(false);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void commitNavigation();
            if (e.key === 'Escape') stopEditing();
          }}
          onBlur={stopEditing}
        />
      ) : (
        <div
          className="nav-url"
          title={displayUrl || 'Click to enter a URL'}
          onClick={startEditing}
        >
          {displayUrl || 'Enter a URL...'}
        </div>
      )}
      <button
        className="nav-btn nav-keeper-btn"
        onClick={() => window.electronAPI.openExtensionPopup()}
        title="Keeper Password Manager"
      >
        🔑
      </button>
      {navState.isLoading && <div className="nav-loading-bar" />}
    </div>
  );
}
