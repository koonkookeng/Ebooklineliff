// SSOT Phase 056 §6 — Web workspace reader route (desktop high-perf mode)
// Canonical: apps/frontend/app/(web)/reader/[productId]/page.tsx
// (legacy src/frontend/app/(web)/reader/[id]/page.tsx — [id] ≡ [productId])
// - Desktop/Mobile Web entry to the UniversalViewportRouter: dual-page spread
//   canvas, sidebar TOC stub, split-screen 70/30 for video, keyboard shortcuts.
// - 5-state machine lives in the router; this page only resolves params +
//   tenant theme hints. Zero new deps.
'use client';

import { Suspense, use } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { UniversalViewportRouter } from '../../../../components/viewport/UniversalViewportRouter';
import { ReaderKeyboardHandler } from '../../../../components/reader/ReaderKeyboardHandler';
import { useReaderStore } from '../../../../stores/useReaderStore';
import { CrossDeviceHandoff } from '../../../../components/sync/CrossDeviceHandoff';
import { HandshakeQrButton } from '../../../../components/sync/HandshakeQrButton';

function WebReaderInner({ productId }: { productId: string }) {
  const params = useSearchParams();
  const router = useRouter();
  const type = params.get('type') === 'video' ? 'COURSE_VIDEO' : 'EBOOK';
  const page = Number.parseInt(params.get('page') ?? '1', 10) || 1;
  const lessonId = params.get('lessonId') ?? undefined;
  const color = params.get('color') ?? '#059669';
  // Atomic Phase 059: store-driven keyboard engine for EBOOK (video keeps
  // its player shortcuts; AdaptiveCanvasReader adopts store turns).
  const totalPages = useReaderStore((s) => s.totalPages);
  // Atomic Phase 070: cross-device handoff (SSE toast + QR issuer).
  const storePage = useReaderStore((s) => s.currentPage);

  return (
    <div className="min-h-screen bg-gray-50">
      {type === 'EBOOK' && <ReaderKeyboardHandler productId={productId} totalPages={totalPages} />}
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-2 px-4 pt-4">
        <CrossDeviceHandoff
          productId={productId}
          contentType={type === 'EBOOK' ? 'EBOOK_PAGE' : 'COURSE_LESSON_VIDEO'}
          contentId={lessonId ?? productId}
          deviceType="WEB_DESKTOP"
          position={type === 'EBOOK' ? { pageNumber: storePage } : {}}
          onJump={(pos) => {
            if (pos.pageNumber !== undefined) {
              router.replace(`/reader/${productId}?type=ebook&page=${pos.pageNumber}`);
            } else if (type !== 'EBOOK' && lessonId) {
              router.replace(`/reader/${productId}?type=video&lessonId=${lessonId}`);
            }
          }}
        />
        <HandshakeQrButton productId={productId} />
      </div>
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
