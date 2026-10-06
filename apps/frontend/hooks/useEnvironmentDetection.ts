// SSOT Phase 022 §6.1 — Environment & safe-area detection hook
// Canonical: apps/frontend/hooks/useEnvironmentDetection.ts
// (legacy src/frontend/hooks/useEnvironmentDetection.ts)
// - SSR-safe defaults; single probe element per update (§9 zero-redundant)
// - rAF-throttled resize/orientation listeners; <0.5MB RAM (Gate 5)
// - Writes --sat/--sab/--sal/--sar + --real-vh to :root (§2.1)
'use client';

import { useState, useEffect, useCallback } from 'react';
import type { EnvironmentType, ViewportMetrics, SafeAreaInsets } from '@repo/shared';

export type { EnvironmentType, ViewportMetrics, SafeAreaInsets };

const DEFAULT_METRICS: ViewportMetrics = {
  windowWidth: 375,
  windowHeight: 667,
  devicePixelRatio: 1,
  isTouchDevice: false,
  safeArea: { top: 0, bottom: 0, left: 0, right: 0 },
  environment: 'DESKTOP_BROWSER',
};

function detectEnvironment(): EnvironmentType {
  if (typeof window === 'undefined') return 'DESKTOP_BROWSER';
  const ua = navigator.userAgent || '';
  const isLine = /Line/i.test(ua);
  const isIOS = /iPhone|iPad|iPod/i.test(ua);
  const isAndroid = /Android/i.test(ua);
  const isStandalone =
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true;

  if (isLine && isIOS) return 'LINE_LIFF_IOS';
  if (isLine && isAndroid) return 'LINE_LIFF_ANDROID';
  if (isStandalone) return 'STANDALONE_PWA';
  if (isIOS && !isLine) return 'MOBILE_SAFARI';
  if (isAndroid && !isLine) return 'MOBILE_CHROME';
  if (/FBAN|FBAV|Instagram|Twitter|MicroMessenger/i.test(ua)) return 'IN_APP_WEBVIEW';
  return window.innerWidth < 1024 ? 'IN_APP_WEBVIEW' : 'DESKTOP_BROWSER';
}

function readSafeArea(): SafeAreaInsets {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { top: 0, bottom: 0, left: 0, right: 0 };
  }
  const probe = document.createElement('div');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.cssText =
    'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;' +
    'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);' +
    'padding-left:env(safe-area-inset-left,0px);padding-right:env(safe-area-inset-right,0px);';
  document.body.appendChild(probe);
  const cs = window.getComputedStyle(probe);
  const insets: SafeAreaInsets = {
    top: parseFloat(cs.paddingTop) || 0,
    bottom: parseFloat(cs.paddingBottom) || 0,
    left: parseFloat(cs.paddingLeft) || 0,
    right: parseFloat(cs.paddingRight) || 0,
  };
  document.body.removeChild(probe);
  return insets;
}

function applyCssVars(safeArea: SafeAreaInsets): void {
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  const root = document.documentElement.style;
  root.setProperty('--sat', `${safeArea.top}px`);
  root.setProperty('--sab', `${safeArea.bottom}px`);
  root.setProperty('--sal', `${safeArea.left}px`);
  root.setProperty('--sar', `${safeArea.right}px`);
  // --dvh fallback for legacy Android webviews where env() returns 0px (§1.3)
  root.setProperty('--real-vh', `${window.innerHeight * 0.01}px`);
}

export const useEnvironmentDetection = () => {
  const [metrics, setMetrics] = useState<ViewportMetrics>(DEFAULT_METRICS);

  const updateMetrics = useCallback(() => {
    const safeArea = readSafeArea();
    applyCssVars(safeArea);
    setMetrics({
      windowWidth: window.innerWidth,
      windowHeight: window.innerHeight,
      devicePixelRatio: window.devicePixelRatio || 1,
      isTouchDevice: 'ontouchstart' in window || navigator.maxTouchPoints > 0,
      safeArea,
      environment: detectEnvironment(),
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    updateMetrics();
    let raf = 0;
    const onChange = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(updateMetrics);
    };
    window.addEventListener('resize', onChange);
    window.addEventListener('orientationchange', onChange);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onChange);
      window.removeEventListener('orientationchange', onChange);
    };
  }, [updateMetrics]);

  return metrics;
};

export default useEnvironmentDetection;
