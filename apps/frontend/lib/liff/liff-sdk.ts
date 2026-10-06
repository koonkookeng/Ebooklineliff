// SSOT Phase 021 — LINE LIFF SDK v2.22+ wrapper (dynamic import, memory-optimized)
// Canonical: apps/frontend/lib/liff/liff-sdk.ts
// (legacy src/frontend/lib/liff/liff-sdk.ts)
// - Dynamic import keeps SDK out of initial bundle (RAM/bundle budget)
// - Singleton pattern for SDK instance (shared across components)
// - No hard dependency on @line/liff in bundle (optional peer dep)

let liffInstance: typeof import('@line/liff').default | null = null;
let initPromise: Promise<typeof import('@line/liff').default> | null = null;
let initConfig: { liffId: string } | null = null;

/**
 * Get the LIFF SDK instance (singleton, lazy-loaded).
 * Uses dynamic import to keep SDK out of initial bundle (< 30MB RAM budget).
 */
export async function getLiff(): Promise<typeof import('@line/liff').default> {
  if (liffInstance) return liffInstance;

  if (!initPromise) {
    initPromise = (async () => {
      const mod = (await import('@line/liff').catch(() => null)) as unknown as {
        default?: typeof import('@line/liff').default;
      } | null;
      const liff = (mod?.default ?? mod) as unknown as typeof import('@line/liff').default;
      if (!liff || typeof liff.init !== 'function') throw new Error('LINE LIFF SDK unavailable');
      return liff;
    })();
  }

  liffInstance = await initPromise;
  return liffInstance;
}

/**
 * Initialize LIFF SDK with given LIFF ID.
 * Idempotent: if already initialized with same config, returns existing instance.
 */
export async function initLiff(liffId: string): Promise<typeof import('@line/liff').default> {
  if (liffInstance && initConfig?.liffId === liffId) return liffInstance;

  const liff = await getLiff();
  await liff.init({ liffId });
  initConfig = { liffId };
  return liff;
}

/**
 * Check if LIFF is running in LINE in-app browser.
 */
export function isInClient(): boolean {
  if (typeof window === 'undefined') return false;
  // Check via user agent as fallback before SDK init
  const ua = navigator.userAgent;
  return ua.includes('Line/') || ua.includes('LIFF/');
}

/**
 * Check if LIFF is running in Mini App sub-window (v2.22+).
 */
export async function isSubWindow(): Promise<boolean> {
  try {
    const liff = await getLiff();
    return (liff as any).isSubWindow?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Get app language (v2.22+).
 */
export async function getAppLanguage(): Promise<string | undefined> {
  try {
    const liff = await getLiff();
    return (liff as any).getAppLanguage?.();
  } catch {
    return undefined;
  }
}

/**
 * Get permanent link for a path (v2.22+).
 */
export async function createPermanentLink(path: string): Promise<string> {
  try {
    const liff = await getLiff();
    return (liff as any).permanentLink?.createUrl?.(path) ?? `${typeof window !== 'undefined' ? window.location.origin : ''}${path}`;
  } catch {
    return `${typeof window !== 'undefined' ? window.location.origin : ''}${path}`;
  }
}

/**
 * Get ID token for backend handshake.
 */
export async function getIDToken(): Promise<string | null> {
  try {
    const liff = await getLiff();
    return liff.getIDToken?.() ?? null;
  } catch {
    return null;
  }
}

/**
 * Check if user is logged in.
 */
export async function isLoggedIn(): Promise<boolean> {
  try {
    const liff = await getLiff();
    return liff.isLoggedIn?.() ?? false;
  } catch {
    return false;
  }
}

/**
 * Trigger LINE login flow.
 */
export async function login(redirectUri?: string): Promise<void> {
  const liff = await getLiff();
  await liff.login({ redirectUri });
}

/**
 * Logout from LINE.
 */
export async function logout(): Promise<void> {
  try {
    const liff = await getLiff();
    liff.logout?.();
  } catch {
    // ignore
  }
}

/**
 * Reset LIFF instance (for testing or re-init with different config).
 */
export function resetLiff(): void {
  liffInstance = null;
  initPromise = null;
  initConfig = null;
}

/** Type re-export for consumers */
export type Liff = typeof import('@line/liff').default;