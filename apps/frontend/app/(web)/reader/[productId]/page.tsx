// SSOT Phase 056 §6 — Web workspace reader route (desktop high-perf mode)
// Canonical: apps/frontend/app/(web)/reader/[productId]/page.tsx
// (legacy src/frontend/app/(web)/reader/[id]/page.tsx — [id] ≡ [productId])
// - Desktop/Mobile Web entry to the UniversalViewportRouter: dual-page spread
//   canvas, sidebar TOC stub, split-screen 70/30 for video, keyboard shortcuts.
// - 5-state machine lives in the router; this page only resolves params +
//   tenant theme hints. Zero new deps.
'use client';

import { Suspense, use } from 'react';
import { useSearchParams } from 'next/navigation';
import { UniversalViewportRouter } from '../../../../components/viewport/UniversalViewportRouter';

function WebReaderInner({ productId }: { productId: string }) {
  const params = useSearchParams();
  const type = params.get('type') === 'video' ? 'COURSE_VIDEO' : 'EBOOK';
  const page = Number.parseInt(params.get('page') ?? '1', 10) || 1;
  const lessonId = params.get('lessonId') ?? undefined;
  const color = params.get('color') ?? '#059669';

  return (
    <div className="min-h-screen bg-gray-50">
      <UniversalViewportRouter
        productId={productId}
        contentType={type}
        initialPage={page}
        initialLessonId={lessonId}
        tenantColor={color}
      />
    </div>
  );
}

export default function WebReaderPage({ params }: { params: Promise<{ productId: string }> }) {
  const { productId } = use(params);
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center" aria-busy>
          <div className="h-8 w-8 animate-spin rounded-full border-t-2 border-emerald-500" />
        </div>
      }
    >
      <WebReaderInner productId={productId} />
    </Suspense>
  );
}
