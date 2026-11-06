// SSOT Phase 131 §6.10 — Post-login confirmation (server-rendered profile)
// Canonical: apps/frontend/app/login/success/page.tsx
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE, backendBaseUrl } from '../../../lib/auth-cookies';
import { LogoutButton } from './logout-button';
import styles from '../login.module.css';

export const metadata = {
  title: 'Signed in',
  robots: { index: false, follow: false },
};

interface Profile {
  displayName?: string;
  email?: string | null;
}

async function loadProfile(token: string): Promise<Profile | null> {
  try {
    const res = await fetch(`${backendBaseUrl()}/api/v1/auth/web/me`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
      signal: AbortSignal.timeout(2500),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: Profile };
    return data.user ?? null;
  } catch {
    return null;
  }
}

export default async function LoginSuccessPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token) redirect('/login');

  const profile = await loadProfile(token);

  return (
    <main className={styles.page}>
      <div className={styles.card}>
        <header className={styles.header}>
          <h1 className={styles.title}>You are signed in</h1>
          <p className={styles.subtitle}>
            {profile?.displayName
              ? `Welcome back, ${profile.displayName}.`
              : 'Your session is active on this device.'}
          </p>
          {profile?.email ? <p className={styles.hint}>{profile.email}</p> : null}
        </header>
        <div className={styles.providers}>
          <a className={`${styles.button} ${styles.primary}`} href="/">
            Continue to the store
          </a>
          <LogoutButton />
        </div>
      </div>
    </main>
  );
}
