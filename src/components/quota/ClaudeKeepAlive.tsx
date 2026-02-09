/**
 * Claude session keep-alive controls.
 *
 * Sends a minimal API request (1 input token, 1 max output token) to start
 * a new 5-hour session immediately after the previous one resets.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { useKeepAliveStore } from '@/stores';
import { apiCallApi, getApiCallErrorMessage } from '@/services/api';
import { normalizeAuthIndexValue } from '@/utils/quota';
import type { AuthFileItem } from '@/types';
import styles from './ClaudeKeepAlive.module.scss';

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';

const KEEP_ALIVE_HEADERS: Record<string, string> = {
  Authorization: 'Bearer $TOKEN$',
  'Content-Type': 'application/json',
  'anthropic-version': '2023-06-01',
  'User-Agent': 'claude-code/2.0.31',
};

const KEEP_ALIVE_BODY = JSON.stringify({
  model: 'claude-3-5-haiku-latest',
  max_tokens: 1,
  messages: [{ role: 'user', content: 'hi' }],
});

/** 5 hours in milliseconds */
const SESSION_DURATION_MS = 5 * 60 * 60 * 1000;

/** Check interval for auto keep-alive: 5 minutes */
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

interface ClaudeKeepAliveProps {
  files: AuthFileItem[];
  disabled: boolean;
}

const formatTimestamp = (ts: number | null): string => {
  if (!ts) return '-';
  const date = new Date(ts);
  if (Number.isNaN(date.getTime())) return '-';
  return date.toLocaleString(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
};

export function ClaudeKeepAlive({ files, disabled }: ClaudeKeepAliveProps) {
  const { t } = useTranslation();
  const accounts = useKeepAliveStore((s) => s.accounts);
  const setAccountEnabled = useKeepAliveStore((s) => s.setAccountEnabled);
  const setAccountStatus = useKeepAliveStore((s) => s.setAccountStatus);
  const setAccountLastKeepAlive = useKeepAliveStore((s) => s.setAccountLastKeepAlive);
  const setAccountNextScheduled = useKeepAliveStore((s) => s.setAccountNextScheduled);
  const removeStaleAccounts = useKeepAliveStore((s) => s.removeStaleAccounts);

  const claudeFiles = useMemo(
    () => files.filter((f) => {
      const provider = (f.provider ?? f.type ?? '').toString().trim().toLowerCase();
      return provider === 'claude';
    }),
    [files]
  );

  // Clean up stale accounts when file list changes
  useEffect(() => {
    if (claudeFiles.length > 0) {
      removeStaleAccounts(claudeFiles.map((f) => f.name));
    }
  }, [claudeFiles, removeStaleAccounts]);

  const sendKeepAlive = useCallback(
    async (file: AuthFileItem) => {
      const rawAuthIndex = file['auth_index'] ?? file.authIndex;
      const authIndex = normalizeAuthIndexValue(rawAuthIndex);
      if (!authIndex) return;

      setAccountStatus(file.name, 'sending');

      try {
        const result = await apiCallApi.request({
          authIndex,
          method: 'POST',
          url: ANTHROPIC_MESSAGES_URL,
          header: { ...KEEP_ALIVE_HEADERS },
          data: KEEP_ALIVE_BODY,
        });

        if (result.statusCode >= 200 && result.statusCode < 300) {
          const now = Date.now();
          setAccountLastKeepAlive(file.name, now);
          setAccountNextScheduled(file.name, now + SESSION_DURATION_MS);
        } else {
          setAccountStatus(file.name, 'error', getApiCallErrorMessage(result));
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        setAccountStatus(file.name, 'error', message);
      }
    },
    [setAccountStatus, setAccountLastKeepAlive, setAccountNextScheduled]
  );

  // Auto keep-alive timer
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    const enabledFiles = claudeFiles.filter((f) => accounts[f.name]?.enabled);
    if (enabledFiles.length === 0 || disabled) return;

    const checkAndSend = () => {
      const now = Date.now();
      for (const file of enabledFiles) {
        const account = accounts[file.name];
        if (!account?.enabled) continue;
        if (account.status === 'sending') continue;

        const nextScheduled = account.nextScheduled;
        if (nextScheduled && now >= nextScheduled) {
          void sendKeepAlive(file);
        }
      }
    };

    // Check immediately
    checkAndSend();

    intervalRef.current = setInterval(checkAndSend, CHECK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [claudeFiles, accounts, disabled, sendKeepAlive]);

  if (claudeFiles.length === 0) return null;

  return (
    <Card title={t('claude_keepalive.title')}>
      <p className={styles.description}>{t('claude_keepalive.description')}</p>
      <div className={styles.accountList}>
        {claudeFiles.map((file) => {
          const account = accounts[file.name];
          const isEnabled = account?.enabled ?? false;
          const status = account?.status ?? 'idle';
          const lastKeepAlive = account?.lastKeepAlive ?? null;
          const nextScheduled = account?.nextScheduled ?? null;
          const error = account?.error;

          return (
            <div key={file.name} className={styles.accountRow}>
              <div className={styles.accountHeader}>
                <span className={styles.accountName} title={file.name}>
                  {file.name}
                </span>
                <div className={styles.accountActions}>
                  <label className={styles.toggleLabel}>
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={(e) => {
                        const checked = e.target.checked;
                        setAccountEnabled(file.name, checked);
                        if (checked && !nextScheduled) {
                          // Schedule immediately when enabling for the first time
                          setAccountNextScheduled(file.name, Date.now());
                        }
                      }}
                      disabled={disabled}
                    />
                    <span>{t('claude_keepalive.auto_toggle')}</span>
                  </label>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => void sendKeepAlive(file)}
                    disabled={disabled || status === 'sending'}
                    loading={status === 'sending'}
                  >
                    {t('claude_keepalive.send_button')}
                  </Button>
                </div>
              </div>
              <div className={styles.accountMeta}>
                <span>
                  {t('claude_keepalive.last_sent')}: {formatTimestamp(lastKeepAlive)}
                </span>
                {isEnabled && nextScheduled && (
                  <span>
                    {t('claude_keepalive.next_scheduled')}: {formatTimestamp(nextScheduled)}
                  </span>
                )}
                {status === 'success' && (
                  <span className={styles.statusSuccess}>
                    {t('claude_keepalive.status_success')}
                  </span>
                )}
                {status === 'error' && error && (
                  <span className={styles.statusError} title={error}>
                    {t('claude_keepalive.status_error')}: {error}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
