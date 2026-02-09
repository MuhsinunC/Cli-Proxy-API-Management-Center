/**
 * Keep-alive state management for Claude session auto-start.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface KeepAliveAccountState {
  enabled: boolean;
  lastKeepAlive: number | null;
  nextScheduled: number | null;
  status: 'idle' | 'sending' | 'success' | 'error';
  error?: string;
}

interface KeepAliveStoreState {
  accounts: Record<string, KeepAliveAccountState>;
  setAccountEnabled: (name: string, enabled: boolean) => void;
  setAccountStatus: (
    name: string,
    status: KeepAliveAccountState['status'],
    error?: string
  ) => void;
  setAccountLastKeepAlive: (name: string, timestamp: number) => void;
  setAccountNextScheduled: (name: string, timestamp: number | null) => void;
  getOrCreateAccount: (name: string) => KeepAliveAccountState;
  removeStaleAccounts: (validNames: string[]) => void;
}

const DEFAULT_ACCOUNT_STATE: KeepAliveAccountState = {
  enabled: false,
  lastKeepAlive: null,
  nextScheduled: null,
  status: 'idle',
};

export const useKeepAliveStore = create<KeepAliveStoreState>()(
  persist(
    (set, get) => ({
      accounts: {},

      setAccountEnabled: (name, enabled) =>
        set((state) => ({
          accounts: {
            ...state.accounts,
            [name]: {
              ...(state.accounts[name] ?? DEFAULT_ACCOUNT_STATE),
              enabled,
            },
          },
        })),

      setAccountStatus: (name, status, error) =>
        set((state) => ({
          accounts: {
            ...state.accounts,
            [name]: {
              ...(state.accounts[name] ?? DEFAULT_ACCOUNT_STATE),
              status,
              error: error ?? undefined,
            },
          },
        })),

      setAccountLastKeepAlive: (name, timestamp) =>
        set((state) => ({
          accounts: {
            ...state.accounts,
            [name]: {
              ...(state.accounts[name] ?? DEFAULT_ACCOUNT_STATE),
              lastKeepAlive: timestamp,
              status: 'success',
            },
          },
        })),

      setAccountNextScheduled: (name, timestamp) =>
        set((state) => ({
          accounts: {
            ...state.accounts,
            [name]: {
              ...(state.accounts[name] ?? DEFAULT_ACCOUNT_STATE),
              nextScheduled: timestamp,
            },
          },
        })),

      getOrCreateAccount: (name) => {
        const state = get();
        return state.accounts[name] ?? DEFAULT_ACCOUNT_STATE;
      },

      removeStaleAccounts: (validNames) =>
        set((state) => {
          const validSet = new Set(validNames);
          const next: Record<string, KeepAliveAccountState> = {};
          for (const [name, account] of Object.entries(state.accounts)) {
            if (validSet.has(name)) {
              next[name] = account;
            }
          }
          return { accounts: next };
        }),
    }),
    {
      name: 'cpa-keepalive-state',
      partialize: (state) => ({
        accounts: Object.fromEntries(
          Object.entries(state.accounts).map(([name, account]) => [
            name,
            {
              enabled: account.enabled,
              lastKeepAlive: account.lastKeepAlive,
              nextScheduled: account.nextScheduled,
              status: 'idle' as const,
            },
          ])
        ),
      }),
    }
  )
);
