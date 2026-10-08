// SSOT Phase 056 §6.2 — Universal Viewport Router (LIFF ↔ Web auto-switch)
// Canonical: apps/frontend/components/viewport/UniversalViewportRouter.tsx
// (legacy src/frontend/components/viewport/UniversalViewportRouter.tsx)
// - 5-state machine: LIFF_INIT (tenant splash) → VIEWPORT_DETECT → HYDRATING
//   (skeleton) → ACTIVE_VIEW (reader/player + watermark) / ERROR_FALLBACK
//   (retry + Web direct link). Zero-flicker: single shell, lazy branches.
// - Injects multi-tenant CSS vars (--primary-color, --logo-url,
//   --font-family) on the root element within the first paint.
// - Zero new deps.
'use client';

import React, { Suspense, lazy, useEffect, useMemo } from 'react';
import { useViewportEnvironment } from '../../hooks/useViewportEnvironment';
import { isLiffEnvironment } from '@repo/shared';

const AdaptiveCanvasReader = lazy(() =>
  import('../reader/AdaptiveCanvasReader').then((m) => ({ default: m.AdaptiveCanvasReader })),
);
const AdaptiveHlsPlayer = lazy(() =>
  import('../player/AdaptiveHlsPlayer').then((m) => ({ default: m.AdaptiveHlsPlayer })),
);

interface UniversalViewportRouterProps {
  productId: string;
  contentType: 'EBOOK' | 'COURSE_VIDEO';
  initialPage?: number;
  initialLessonId?: string;
  tenantColor?: string;
  tenantLogoUrl?: string;
  tenantFontFamily?: string;
}

function ViewportSkeleton({ message }: { message: string }) {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-background" aria-busy>
      <div className="flex flex-col items-center gap-4">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent" />
        <p className="text-sm font-medium text-muted-foreground">{message}</p>
      </div>
    </div>
  );
}

export const UniversalViewportRouter: React.FC<UniversalViewportRouterProps> = ({
  productId,
  contentType,
  initialPage = 1,
  initialLessonId,
  tenantColor = '#059669',
  tenantLogoUrl,
  tenantFontFamily,
}) => {
  const { capabilities, isLoading, uiState, error, retry } = useViewportEnvironment();

  useEffect(() => {
    const root = document.documentElement;
    root.style.setProperty('--primary-color', tenantColor);
    if (tenantLogoUrl) root.style.setProperty('--logo-url', `url(${tenantLogoUrl})`);
    if (tenantFontFamily) root.style.setProperty('--font-family', tenantFontFamily);
  }, [tenantColor, tenantLogoUrl, tenantFontFamily]);

  const envClass = useMemo(
    () => (capabilities ? capabilities.environment.toLowerCase().replace(/_/g, '-') : 'viewport-detecting'),
    [capabilities],
  );

  if (isLoading || !capabilities) {
    return <ViewportSkeleton message="กำลังปรับแต่งระบบการแสดงผล (Viewport Auto-Adapting)..." />;
  }

  if (uiState === 'ERROR_FALLBACK') {
    return (
      <div className="flex h-screen w-full flex-col items-center justify-center gap-4 bg-background px-6 text-center" role="alert">
        <p className="text-sm font-semibold">ไม่สามารถตรวจจับสภาพแวดล้อมได้{error ? `: ${error}` : ''}</p>
        <div className="flex gap-3">
          <button onClick={retry} className="rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground">
            ลองใหม่
          </button>
          <a href={`/reader/${productId}`} className="rounded-lg border px-4 py-2 text-sm">
            เปิดบนเว็บโดยตรง
          </a>
        </div>
      </div>
    );
  }

  const liff = isLiffEnvironment(capabilities.environment);

  return (
    <div className={`universal-viewport-root ${envClass}`} data-liff={liff} data-env={capabilities.environment}>
      <Suspense fallback={<ViewportSkeleton message="กำลังโหลดตัวอ่าน (Hydrating)..." />}>
        {contentType === 'EBOOK' ? (
          <AdaptiveCanvasReader productId={productId} initialPage={initialPage} capabilities={capabilities} />
        ) : (
          <AdaptiveHlsPlayer productId={productId} initialLessonId={initialLessonId} capabilities={capabilities} />
        )}
      </Suspense>
    </div>
  );
};

export default UniversalViewportRouter;
