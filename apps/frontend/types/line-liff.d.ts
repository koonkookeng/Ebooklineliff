// SSOT Phase 021 — lazy LIFF types (RAM guard: no static import, dynamic only)
// Canonical: apps/frontend/types/line-liff.d.ts
// Updated for v2.22+ with Mini App APIs

declare module '@line/liff' {
  export interface LiffProfile {
    userId: string;
    displayName: string;
    pictureUrl?: string;
    statusMessage?: string;
  }

  export interface Liff {
    init(args: { liffId: string }): Promise<void>;
    isLoggedIn(): boolean;
    isInClient(): boolean;
    isSubWindow(): boolean;
    getAppLanguage(): string;
    getIDToken(): string | null;
    getAccessToken(): string | null;
    getProfile(): Promise<LiffProfile>;
    login(options?: { redirectUri?: string }): Promise<void>;
    logout(): void;
    permanentLink: {
      createUrl: (path: string) => string;
    };
  }

  const liff: Liff;
  export default liff;
}