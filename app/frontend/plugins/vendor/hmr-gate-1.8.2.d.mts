import type { Plugin } from 'vite';

export interface HmrGateOptions {
  fullReload?: boolean;
  events?: string[];
  passthrough?: string[];
  drainMs?: number;
  maxHoldMs?: number;
  startupGraceMs?: number;
  /** Local patch: false disables hold-expiry releases. */
  failOpen?: boolean;
  /** Local patch: required x-mgx-hmr-token value; defaults to MGX_HMR_GATE_TOKEN. */
  token?: string;
}

export declare const BOOT_PROGRESS_EVENT: string;
export declare const DEV_SERVER_MODE_EVENT: string;
export declare const FULL_RELOAD_ENV_VAR: string;
export declare const UPDATE_PROGRESS_EVENT: string;
export declare function hmrGatePlugin(options?: HmrGateOptions): Plugin;
