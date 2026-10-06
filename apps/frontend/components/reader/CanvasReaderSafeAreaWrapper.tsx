// SSOT Phase 022 §6.2 — Canvas reader safe-area wrapper
// Canonical: apps/frontend/components/reader/CanvasReaderSafeAreaWrapper.tsx
// (legacy src/frontend/components/reader/CanvasReaderSafeAreaWrapper.tsx)
// - Control chrome never clipped: padding derived from live safe-area insets
// - Viewport height uses --real-vh (legacy Android webview fallback, §1.3)
'use client';

import React from 'react';
import { useEnvironmentDetection } from '../../hooks/useEnvironmentDetection';

interface CanvasReaderSafeAreaWrapperProps {
  children: React.ReactNode;
  onPageChange?: (page: number) => void;
  topBar?: React.ReactNode;
  bottomControls?: React.ReactNode;
}

export const CanvasReaderSafeAreaWrapper: React.FC<CanvasReaderSafeAreaWrapperProps> = ({
  children,
  onPageChange,
  topBar,
  bottomControls,
}) => {
  const { safeArea, environment } = useEnvironmentDetection();

  // Dynamic style ensuring control buttons are never clipped (§6.2)
  const containerStyle: React.CSSProperties = {
    paddingTop: `${Math.max(safeArea.top, 12)}px`,
    paddingBottom: `${Math.max(safeArea.bottom, 16)}px`,
    paddingLeft: `${Math.max(safeArea.left, 8)}px`,
    paddingRight: `${Math.max(safeArea.right, 8)}px`,
    height: 'calc(var(--real-vh, 1vh) * 100)',
    display: 'flex',
    flexDirection: 'column',
    justifyContent: 'space-between',
    boxSizing: 'border-box',
    overflow: 'hidden',
  };

  void onPageChange;

  return (
    <div className={`reader-safe-area-wrapper env-${environment.toLowerCase()}`} style={containerStyle}>
      <div className="reader-top-bar flex justify-between items-center h-12 w-full px-2 bg-background/80 backdrop-blur border-b">
        {topBar ?? (
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {environment.replace(/_/g, ' ')}
          </span>
        )}
      </div>

      <div className="reader-viewport-core flex-1 relative w-full overflow-hidden">{children}</div>

      <div
        className="reader-bottom-controls w-full bg-background/95 backdrop-blur border-t p-2 flex items-center justify-between"
        style={{ marginBottom: `${safeArea.bottom > 0 ? 0 : 8}px` }}
      >
        {bottomControls}
      </div>
    </div>
  );
};

export default CanvasReaderSafeAreaWrapper;
