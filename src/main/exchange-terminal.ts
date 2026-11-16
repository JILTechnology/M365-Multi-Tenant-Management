import os from 'node:os';
import type { WebContents } from 'electron';
import { spawn, type IPty } from 'node-pty';
import { IPC_CHANNELS } from '../types/index';
import { buildExchangeConnectCommand, type ExchangePowerShellEntry } from './exchange-powershell';

/** One PowerShell session per window and tenant, kept alive while the user switches tabs. */
const sessions = new Map<string, IPty>();

function sessionKey(contents: WebContents, tenantId: string): string {
  return `${contents.id}:${tenantId}`;
}

export function openExchangeTerminal(
  contents: WebContents,
  tenantId: string,
  entry: ExchangePowerShellEntry,
  cols: number,
  rows: number,
): void {
  const key = sessionKey(contents, tenantId);
  const existing = sessions.get(key);
  if (existing) {
    existing.resize(cols, rows);
    return;
  }

  const shell = spawn(
    'pwsh.exe',
    ['-NoLogo', '-NoExit', '-Command', buildExchangeConnectCommand(entry)],
    {
      name: 'xterm-256color',
      cols,
      rows,
      cwd: os.homedir(),
      env: process.env as Record<string, string>,
    },
  );
  sessions.set(key, shell);

  shell.onData((data) => {
    if (!contents.isDestroyed()) {
      contents.send(IPC_CHANNELS.TERMINAL_DATA, { tenantId, data });
    }
  });
  shell.onExit(() => {
    if (sessions.get(key) === shell) sessions.delete(key);
    if (!contents.isDestroyed()) {
      contents.send(IPC_CHANNELS.TERMINAL_EXIT, { tenantId });
    }
  });
}

export function writeExchangeTerminal(contents: WebContents, tenantId: string, data: string): void {
  sessions.get(sessionKey(contents, tenantId))?.write(data);
}

export function resizeExchangeTerminal(
  contents: WebContents,
  tenantId: string,
  cols: number,
  rows: number,
): void {
  sessions.get(sessionKey(contents, tenantId))?.resize(cols, rows);
}

/** Ends every session that belongs to a closed window. */
export function closeExchangeTerminals(webContentsId: number): void {
  for (const [key, shell] of sessions) {
    if (key.startsWith(`${webContentsId}:`)) {
      sessions.delete(key);
      shell.kill();
    }
  }
}
