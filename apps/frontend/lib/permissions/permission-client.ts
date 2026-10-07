// SSOT Phase 032 §6/§8 — Permission edge client (audit + geocode + helpers)
// Canonical: apps/frontend/lib/permissions/permission-client.ts
// (legacy src/frontend/lib/permissions/permission-client.ts)
// - logPermissionEvent: fire-and-forget audit beacon (JWT cookie binds identity).
// - reverseGeocode: GPS → admin address via the v1 proxy (800ms budget client
//   timeout via AbortController; null on timeout/503 — caller keeps manual form).
// - copyText: clipboard with textarea fallback (settings-path copy, BDD Sc. 3).
// - stopMediaStream: revokes every track (RAM/stream cleanup on dialog close,
//   Gate 5 — camera streams never leak past the sheet lifecycle).
// - Zero new deps.
import {
  SETTINGS_PATH_COPY,
  detectDevicePlatform,
  type DevicePlatform,
  type PermissionStatus,
  type PermissionType,
} from '@repo/shared';

export { SETTINGS_PATH_COPY, detectDevicePlatform };
export type { DevicePlatform };

export interface PermissionEventInput {
  permissionType: PermissionType;
  status: PermissionStatus;
  purpose?: string;
  tenantId?: string;
}

export async function logPermissionEvent(input: PermissionEventInput): Promise<boolean> {
  try {
    const res = await fetch('/api/v1/permission/audit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        permissionType: input.permissionType,
        status: input.status,
        purpose: input.purpose ?? 'unspecified',
        requestedAt: new Date().toISOString(),
      }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface GeocodeResult {
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
  formattedAddress: string;
}

export async function reverseGeocode(latitude: number, longitude: number, timeoutMs = 8000): Promise<GeocodeResult | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(
      `/api/v1/permission/reverse-geocode?lat=${encodeURIComponent(latitude)}&lng=${encodeURIComponent(longitude)}`,
      { headers: { Accept: 'application/json' }, signal: controller.signal },
    );
    if (!res.ok) return null;
    return (await res.json()) as GeocodeResult;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard API blocked: fall through to textarea shim.
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.style.position = 'fixed';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/** Stop every live track of a camera/mic stream (dialog-close cleanup). */
export function stopMediaStream(stream: { getTracks?: () => Array<{ stop?: () => void }> } | null | undefined): void {
  try {
    for (const track of stream?.getTracks?.() ?? []) {
      try {
        track.stop?.();
      } catch {
        // Single-track failure must not block the sweep.
      }
    }
  } catch {
    // Non-media runtime (tests): nothing to stop.
  }
}
