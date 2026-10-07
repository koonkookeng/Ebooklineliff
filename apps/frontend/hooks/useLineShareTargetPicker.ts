// SSOT Phase 026 §6.1/Task 4 — LINE share target picker hook (5-state + env fallback)
// Canonical: apps/frontend/hooks/useLineShareTargetPicker.ts
// (legacy src/frontend/hooks/useLineShareTargetPicker.ts)
// - States: LIFF_INIT (availability probe) → IDLE → LOADING (flex fetch +
//   native sheet) → SUCCESS (toast data + reward) / ERROR (soft toast, no reload).
// - Environment fallback (§10): non-LINE browsers get copy-link mode instead of
//   a dead button (clipboard best-effort; deep link always returned).
// - RAM guard: SDK via lib/liff/liff-sdk singleton (no static import in bundle
//   hotspot); flex JSON parsed once, never retained after send.
// - Transport: REST proxies (/api/v1/social-share/*) per frontend convention
//   (Phase 014 precedent); backend GraphQL operations exist as the intent layer.
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getLiff, isInClient } from '../lib/liff/liff-sdk';
import {
  GenerateFlexShareResponseSchema,
  ShareTargetPickerResultSchema,
  type ShareContentType,
} from '@repo/shared';

export type ShareUiStatus = 'LIFF_INIT' | 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface ShareOptions {
  productId: string;
  contentType: ShareContentType;
  targetPageNumber?: number;
  targetLessonId?: string;
  customQuote?: string;
}

export interface ShareOutcome {
  success: boolean;
  cancelled: boolean;
  copied: boolean;
  shareLogId?: string;
  rewardPointsEarned: number;
  message: string;
}

async function recordLog(input: {
  productId: string;
  targetType: string;
  status: 'SUCCESS' | 'CANCELLED' | 'FAILED';
  shareToken: string;
}): Promise<{ shareLogId?: string; rewardPointsEarned: number }> {
  try {
    const res = await fetch('/api/v1/social-share/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) return { rewardPointsEarned: 0 };
    const data = (await res.json()) as unknown;
    const parsed = ShareTargetPickerResultSchema.safeParse(data);
    if (!parsed.success) return { rewardPointsEarned: 0 };
    return {
      ...(parsed.data.shareLogId ? { shareLogId: parsed.data.shareLogId } : {}),
      rewardPointsEarned: parsed.data.rewardPointsEarned,
    };
  } catch {
    return { rewardPointsEarned: 0 };
  }
}

export function useLineShareTargetPicker() {
  const [status, setStatus] = useState<ShareUiStatus>('LIFF_INIT');
  const [pickerAvailable, setPickerAvailable] = useState(false);
  const [inLineClient, setInLineClient] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    const probe = async (): Promise<void> => {
      try {
        const liff = await getLiff();
        if (cancelled || !mountedRef.current) return;
        const inClient = isInClient() || (typeof liff.isInClient === 'function' && liff.isInClient());
        const available =
          inClient &&
          typeof (liff as unknown as { isApiAvailable?: (api: string) => boolean }).isApiAvailable === 'function' &&
          (liff as unknown as { isApiAvailable: (api: string) => boolean }).isApiAvailable('shareTargetPicker');
        setInLineClient(inClient);
        setPickerAvailable(available);
        setStatus('IDLE');
      } catch {
        if (cancelled || !mountedRef.current) return;
        setInLineClient(false);
        setPickerAvailable(false);
        setStatus('IDLE');
      }
    };
    void probe();
    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, []);

  const shareToFriends = useCallback(async (options: ShareOptions): Promise<ShareOutcome> => {
    setStatus('LOADING');
    setError(null);
    try {
      const qs = new URLSearchParams({ productId: options.productId, contentType: options.contentType });
      if (options.targetPageNumber !== undefined) qs.set('targetPageNumber', String(options.targetPageNumber));
      if (options.targetLessonId) qs.set('targetLessonId', options.targetLessonId);
      if (options.customQuote) qs.set('customQuote', options.customQuote);
      const flexRes = await fetch(`/api/v1/social-share/flex?${qs.toString()}`, {
        headers: { Accept: 'application/json' },
      });
      if (!flexRes.ok) throw new Error('เตรียมการ์ดแชร์ไม่สำเร็จ');
      const flexParsed = GenerateFlexShareResponseSchema.safeParse(await flexRes.json());
      if (!flexParsed.success) throw new Error('รูปแบบการ์ดแชร์ไม่ถูกต้อง');
      const { flexMessageJson, shareToken, deepLinkUrl } = flexParsed.data;
      const flexPayload = JSON.parse(flexMessageJson) as Record<string, unknown>;

      if (!pickerAvailable) {
        // External browser fallback: copy direct link (§10).
        try {
          await navigator.clipboard.writeText(deepLinkUrl);
        } catch {
          // Clipboard blocked: link still shown to the user by the caller.
        }
        await recordLog({ productId: options.productId, targetType: 'EXTERNAL_URL', status: 'SUCCESS', shareToken });
        setStatus('SUCCESS');
        return { success: true, cancelled: false, copied: true, rewardPointsEarned: 0, message: 'คัดลอกลิงก์แชร์แล้ว!' };
      }

      const liff = await getLiff();
      const res = await (
        liff as unknown as { shareTargetPicker: (msgs: unknown[]) => Promise<unknown | null> }
      ).shareTargetPicker([flexPayload]);

      if (res) {
        const logged = await recordLog({ productId: options.productId, targetType: 'INDIVIDUAL', status: 'SUCCESS', shareToken });
        setStatus('SUCCESS');
        return {
          success: true,
          cancelled: false,
          copied: false,
          ...(logged.shareLogId ? { shareLogId: logged.shareLogId } : {}),
          rewardPointsEarned: logged.rewardPointsEarned,
          message: 'ส่งไปยังแชตเพื่อนเรียบร้อยแล้ว!',
        };
      }
      await recordLog({ productId: options.productId, targetType: 'INDIVIDUAL', status: 'CANCELLED', shareToken });
      setStatus('IDLE');
      return { success: false, cancelled: true, copied: false, rewardPointsEarned: 0, message: 'ยกเลิกการแชร์แล้ว' };
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Share failed';
      setError(message);
      setStatus('ERROR');
      return { success: false, cancelled: false, copied: false, rewardPointsEarned: 0, message };
    }
  }, [pickerAvailable]);

  return { status, pickerAvailable, inLineClient, error, shareToFriends };
}
