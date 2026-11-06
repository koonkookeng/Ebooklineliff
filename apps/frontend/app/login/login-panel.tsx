'use client';

// SSOT Phase 131 §6.9 — Provider chooser + email magic-link form
// Canonical: apps/frontend/app/login/login-panel.tsx
import { useState } from 'react';
import styles from './login.module.css';

interface LoginPanelProps {
  tenant: string;
  next: string;
  error?: string;
}

type EmailState = 'idle' | 'submitting' | 'sent' | 'error';

const ERROR_MESSAGES: Record<string, string> = {
  oauth_unavailable: 'This sign-in provider is not configured yet.',
  oauth_failed: 'We could not complete the sign-in. Please try again.',
  oauth_denied: 'Sign-in was cancelled.',
  unsupported_provider: 'Unknown sign-in provider.',
  magic_link_invalid: 'This sign-in link is invalid or has expired.',
  session_expired: 'Your session expired. Please sign in again.',
  rate_limited: 'Too many attempts. Please wait a minute and try again.',
};

function withQuery(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params);
  return `${path}?${query.toString()}`;
}

export function LoginPanel({ tenant, next, error }: LoginPanelProps) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<EmailState>('idle');
  const [message, setMessage] = useState('');

  const lineHref = withQuery('/api/auth/start', { provider: 'line', tenant, next });
  const googleHref = withQuery('/api/auth/start', { provider: 'google', tenant, next });
  const errorMessage = error ? ERROR_MESSAGES[error] ?? ERROR_MESSAGES.oauth_failed : '';

  async function requestMagicLink(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state === 'submitting') return;
    setState('submitting');
    setMessage('');
    try {
      const res = await fetch('/api/auth/email/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, tenant, next }),
      });
      if (res.ok) {
        setState('sent');
        setMessage('Check your inbox — we sent you a one-time sign-in link.');
        return;
      }
      if (res.status === 429) {
        setState('error');
        setMessage(ERROR_MESSAGES.rate_limited);
        return;
      }
      if (res.status === 400) {
        setState('error');
        setMessage('Please enter a valid email address.');
        return;
      }
      setState('error');
      setMessage('Email sign-in is temporarily unavailable.');
    } catch {
      setState('error');
      setMessage('Network error. Please try again.');
    }
  }

  return (
    <div className={styles.card}>
      <header className={styles.header}>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>
          Continue with LINE, Google, or a one-time email link. No password required.
        </p>
      </header>

      {errorMessage ? (
        <p role="alert" className={styles.alert}>
          {errorMessage}
        </p>
      ) : null}

      <div className={styles.providers}>
        <a className={`${styles.button} ${styles.line}`} href={lineHref}>
          <span aria-hidden="true" className={styles.badge}>
            LINE
          </span>
          Continue with LINE
        </a>
        <a className={`${styles.button} ${styles.google}`} href={googleHref}>
          <span aria-hidden="true" className={styles.badge}>
            G
          </span>
          Continue with Google
        </a>
      </div>

      <div className={styles.divider}>
        <span>or use email</span>
      </div>

      <form className={styles.form} onSubmit={requestMagicLink} noValidate>
        <label className={styles.label} htmlFor="login-email">
          Email address
        </label>
        <input
          id="login-email"
          className={styles.input}
          type="email"
          name="email"
          autoComplete="email"
          inputMode="email"
          required
          placeholder="you@example.com"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          disabled={state === 'submitting' || state === 'sent'}
        />
        <button
          className={`${styles.button} ${styles.primary}`}
          type="submit"
          disabled={state === 'submitting' || state === 'sent' || email.trim().length === 0}
        >
          {state === 'submitting' ? 'Sending…' : state === 'sent' ? 'Link sent' : 'Email me a sign-in link'}
        </button>
      </form>

      {message ? (
        <p role="status" className={state === 'error' ? styles.error : styles.success}>
          {message}
        </p>
      ) : null}

      <div className={styles.footer}>
        <a className={styles.link} href={withQuery('/auth/qr-login', { tenant })}>
          Sign in with your phone (QR)
        </a>
        <span className={styles.hint}>
          Opening this app inside LINE? It signs you in automatically.
        </span>
      </div>
    </div>
  );
}
