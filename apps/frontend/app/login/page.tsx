// SSOT Phase 131 §6.9 — Web sign-in entry (LINE / Google / Email + optional QR)
// Canonical: apps/frontend/app/login/page.tsx
import { headers } from 'next/headers';
import { sanitizeNextPath } from '@repo/shared';
import { LoginPanel } from './login-panel';
import styles from './login.module.css';

export const metadata = {
  title: 'Sign in',
  robots: { index: false, follow: false },
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ tenant?: string; next?: string; error?: string }>;
}) {
  const params = (await searchParams) ?? {};
  const headerStore = await headers();
  const tenant = params.tenant ?? headerStore.get('x-tenant-identifier') ?? 'default';
  const next = sanitizeNextPath(params.next, '/');
  const error = params.error;

  return (
    <main className={styles.page}>
      <LoginPanel tenant={tenant} next={next} error={error} />
    </main>
  );
}
