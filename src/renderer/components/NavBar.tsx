import type { NavState } from '../../types/index';

interface NavBarProps {
  navState: NavState;
}

export default function NavBar({ navState }: NavBarProps) {
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
      <div className="nav-url" title={navState.url}>
        {navState.url}
      </div>
      {navState.isLoading && <div className="nav-loading-bar" />}
    </div>
  );
}
