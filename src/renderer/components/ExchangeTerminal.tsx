import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

interface TerminalSession {
  term: Terminal;
  fit: FitAddon;
  element: HTMLDivElement;
  opened: boolean;
  running: boolean;
}

// Sessions outlive the component so switching tabs or tenants keeps the scrollback,
// matching the PowerShell process that the main process keeps alive.
const sessions = new Map<string, TerminalSession>();
let listening = false;

function listenForOutput(): void {
  if (listening) return;
  listening = true;
  window.electronAPI.onTerminalData(({ tenantId, data }) => {
    sessions.get(tenantId)?.term.write(data);
  });
  window.electronAPI.onTerminalExit(({ tenantId }) => {
    const session = sessions.get(tenantId);
    if (!session) return;
    session.running = false;
    session.term.write('\r\n\x1b[90m[Session ended. Press any key to start a new one.]\x1b[0m\r\n');
  });
}

function start(tenantId: string, session: TerminalSession): void {
  session.running = true;
  window.electronAPI
    .openTerminal(tenantId, session.term.cols, session.term.rows)
    .catch((error: unknown) => {
      session.running = false;
      const message = error instanceof Error ? error.message : 'Unable to start PowerShell.';
      session.term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`);
    });
}

function getSession(tenantId: string): TerminalSession {
  const existing = sessions.get(tenantId);
  if (existing) return existing;

  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "'Cascadia Mono', Consolas, monospace",
    fontSize: 13,
    scrollback: 10000,
    theme: { background: '#0c0c0c', foreground: '#cccccc' },
  });
  const fit = new FitAddon();
  term.loadAddon(fit);
  const element = document.createElement('div');
  element.className = 'terminal-surface';
  const session: TerminalSession = { term, fit, element, opened: false, running: false };

  term.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || !event.ctrlKey) return true;
    // Let the app's tab shortcuts (Ctrl+1-9, Ctrl+Tab) through.
    if (event.key === 'Tab' || /^[1-9]$/.test(event.key)) return false;
    // Ctrl+C copies when text is selected (via the native copy shortcut); otherwise it interrupts.
    if (event.key.toLowerCase() === 'c' && term.hasSelection()) return false;
    // Ctrl+V is left to the native paste shortcut, which xterm turns into input.
    if (event.key.toLowerCase() === 'v') return false;
    return true;
  });
  term.onData((data) => {
    if (!session.running) {
      term.clear();
      start(tenantId, session);
      return;
    }
    window.electronAPI.writeTerminal(tenantId, data);
  });
  term.onResize(({ cols, rows }) => {
    if (session.running) window.electronAPI.resizeTerminal(tenantId, cols, rows);
  });

  sessions.set(tenantId, session);
  return session;
}

export default function ExchangeTerminal({ tenantId }: { tenantId: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    listenForOutput();
    const session = getSession(tenantId);
    host.appendChild(session.element);
    if (!session.opened) {
      session.term.open(session.element);
      session.opened = true;
    }
    session.fit.fit();
    if (!session.running) start(tenantId, session);
    session.term.focus();

    const observer = new ResizeObserver(() => session.fit.fit());
    observer.observe(host);
    return () => {
      observer.disconnect();
      session.element.remove();
    };
  }, [tenantId]);

  return <div className="terminal-host" ref={hostRef} />;
}
