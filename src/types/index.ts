/**
 * Shared type definitions used across main, preload, and renderer processes.
 */

export const IPC_CHANNELS = {
  APP_GET_VERSION: 'app:get-version',
} as const;

export interface Tenant {
  id: string;
  name: string;
  domain: string;
}
