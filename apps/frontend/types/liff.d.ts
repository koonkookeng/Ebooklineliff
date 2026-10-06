// SSOT Phase 021 — LINE LIFF v2.22+ Type Definitions
// Canonical: apps/frontend/types/liff.d.ts
// (legacy src/frontend/types/liff.d.ts)

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