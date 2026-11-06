'use client';

// SSOT Phase 131 §6.10 — Sign-out control for the success screen
import { useState } from 'react';
import styles from '../login.module.css';

export function LogoutButton() {
  const [busy, setBusy] = useState(false);
  async function signOut() {
    if (busy) return;
    setBusy(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      window.location.href = '/login';
    }
  }
  return (
    <button className={`${styles.button} ${styles.google}`} type="button" onClick={signOut} disabled={busy}>
      {busy ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
