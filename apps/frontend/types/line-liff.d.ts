// SSOT Phase 001 — lazy LIFF types (RAM guard: no static import, dynamic only)
declare module '@line/liff' {
  interface LiffProfile {
    userId: string;
    displayName: string;
    pictureUrl?: string;
  }
  interface Liff {
    init(args: { liffId: string }): Promise<void>;
    isLoggedIn(): boolean;
    getProfile(): Promise<LiffProfile>;
  }
  const liff: Liff;
  export default liff;
}
