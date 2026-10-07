// SSOT Phase 032 Task 3/§6.1 — useDevicePermissions (unified permission engine)
// Canonical: apps/frontend/hooks/useDevicePermissions.ts
// (legacy src/frontend/hooks/useDevicePermissions.ts)
// - Single hook for CAMERA / PHOTO_LIBRARY / GEOLOCATION / MICROPHONE (§9):
//   LIFF_INIT (probe) → IDLE (PROMPT badge) → LOADING (sheet/native) →
//   SUCCESS (GRANTED) / ERROR (DENIED fallback, no native crash).
// - Probe: navigator.permissions.query where meaningful (camera/mic/
//   geolocation); PHOTO_LIBRARY has no queryable name → stays PROMPT until the
//   picker/camera resolves (LINE WebView truth — no guessing, Gate 2).
// - Request: geolocation via getCurrentPosition (10s, low power); camera/mic via
//   getUserMedia (stream handed to onGranted for caller-owned cleanup — the
//   hook ALSO stops preview tracks on unmount, Gate 5); photo library resolves
//   GRANTED optimistically (the <input type=file> picker is the OS prompt and
//   cannot be pre-probed — caller opens it after SUCCESS).
// - Every terminal transition fires the audit beacon (Gate 8, fire-and-forget).
// - Zero new deps.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { GEOLOCATION_TIMEOUT_MS, type PermissionStatus, type PermissionType } from '@repo/shared';
import { logPermissionEvent, stopMediaStream } from '../lib/permissions/permission-client';

export type PermissionUiState = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface GrantedCoords {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface UseDevicePermissionsOptions {
  purpose?: string;
  onGranted?: (stream?: MediaStream, coords?: GrantedCoords) => void;
  onDenied?: (status: PermissionStatus) => void;
}

type QueryableName = 'camera' | 'microphone' | 'geolocation';

function queryNameFor(type: PermissionType): QueryableName | null {
  if (type === 'CAMERA') return 'camera';
  if (type === 'MICROPHONE') return 'microphone';
  if (type === 'GEOLOCATION') return 'geolocation';
  return null;
}

export function useDevicePermissions(permissionType: PermissionType, options?: UseDevicePermissionsOptions) {
  const [uiState, setUiState] = useState<PermissionUiState>('LIFF_INIT');
  const [status, setStatus] = useState<PermissionStatus>('PROMPT');
  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [coords, setCoords] = useState<{ latitude: number; longitude: number; accuracy: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const purposeRef = useRef(options?.purpose ?? 'unspecified');
  purposeRef.current = options?.purpose ?? 'unspecified';
  const callbacksRef = useRef(options);
  callbacksRef.current = options;

  // Unmount safety: never leak a live camera/mic stream (Gate 5).
  useEffect(() => {
    return () => stopMediaStream(streamRef.current);
  }, []);

  const audit = useCallback(
    (next: PermissionStatus) => {
      void logPermissionEvent({ permissionType, status: next, purpose: purposeRef.current });
    },
    [permissionType],
  );

  const checkPermission = useCallback(async (): Promise<PermissionStatus> => {
    const name = queryNameFor(permissionType);
    if (typeof navigator === 'undefined' || !name || !navigator.permissions?.query) {
      setUiState('IDLE');
      return 'PROMPT';
    }
    try {
      const result = await navigator.permissions.query({ name: name as PermissionName });
      const mapped = result.state.toUpperCase();
      const next: PermissionStatus = mapped === 'GRANTED' || mapped === 'DENIED' ? mapped : 'PROMPT';
      setStatus(next);
      setUiState('IDLE');
      return next;
    } catch {
      setUiState('IDLE');
      return 'PROMPT';
    }
  }, [permissionType]);

  useEffect(() => {
    void checkPermission();
  }, [checkPermission]);

  const requestGeolocation = useCallback((): Promise<PermissionStatus> => {
    return new Promise((resolve) => {
      if (typeof navigator === 'undefined' || !navigator.geolocation) {
        setStatus('UNSUPPORTED');
        setUiState('ERROR');
        setError('อุปกรณ์ไม่รองรับ GPS');
        resolve('UNSUPPORTED');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const here: GrantedCoords = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracy: pos.coords.accuracy };
          setCoords(here);
          setStatus('GRANTED');
          setUiState('SUCCESS');
          setIsSheetOpen(false);
          audit('GRANTED');
          callbacksRef.current?.onGranted?.(undefined, here);
          resolve('GRANTED');
        },
        (err) => {
          const next: PermissionStatus = err.code === err.PERMISSION_DENIED ? 'DENIED' : 'RESTRICTED';
          setStatus(next);
          setUiState('ERROR');
          setError(next === 'DENIED' ? 'ถูกปฏิเสธสิทธิ์ตำแหน่ง' : 'ตำแหน่งถูกจำกัด');
          audit(next);
          callbacksRef.current?.onDenied?.(next);
          resolve(next);
        },
        { timeout: GEOLOCATION_TIMEOUT_MS, enableHighAccuracy: false },
      );
    });
  }, [audit]);

  const requestMedia = useCallback(
    async (kind: 'camera' | 'microphone'): Promise<PermissionStatus> => {
      try {
        if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
          setStatus('UNSUPPORTED');
          setUiState('ERROR');
          setError('อุปกรณ์ไม่รองรับการเข้าถึงสื่อ');
          return 'UNSUPPORTED';
        }
        const stream = await navigator.mediaDevices.getUserMedia({ [kind === 'camera' ? 'video' : 'audio']: true });
        stopMediaStream(streamRef.current);
        streamRef.current = stream;
        setStatus('GRANTED');
        setUiState('SUCCESS');
        setIsSheetOpen(false);
        audit('GRANTED');
        callbacksRef.current?.onGranted?.(stream);
        return 'GRANTED';
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        const next: PermissionStatus = name === 'NotAllowedError' ? 'DENIED' : 'RESTRICTED';
        setStatus(next);
        setUiState('ERROR');
        setError(next === 'DENIED' ? 'ถูกปฏิเสธสิทธิ์การเข้าถึง' : 'อุปกรณ์ถูกจำกัด');
        audit(next);
        callbacksRef.current?.onDenied?.(next);
        return next;
      }
    },
    [audit],
  );

  const requestPermission = useCallback(async (): Promise<PermissionStatus> => {
    setError(null);
    setUiState('LOADING');
    if (permissionType === 'GEOLOCATION') return requestGeolocation();
    if (permissionType === 'CAMERA') return requestMedia('camera');
    if (permissionType === 'MICROPHONE') return requestMedia('microphone');
    // PHOTO_LIBRARY: the OS picker IS the prompt (unprobeable) — sheet confirm
    // hands control to the caller's <input type=file> after SUCCESS.
    setStatus('GRANTED');
    setUiState('SUCCESS');
    setIsSheetOpen(false);
    audit('GRANTED');
    callbacksRef.current?.onGranted?.();
    return 'GRANTED';
  }, [permissionType, requestGeolocation, requestMedia, audit]);

  return { uiState, status, isSheetOpen, setIsSheetOpen, coords, error, checkPermission, requestPermission };
}
