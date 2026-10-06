// SSOT Phase 006 §6.1 — useLiffAuth hook (thin surface over LiffAuthProvider context)
// Canonical: apps/frontend/hooks/useLiffAuth.ts
'use client';
import { useLiffAuth } from '../providers/LiffAuthProvider';

export { useLiffAuth, type LiffAuthStatus } from '../providers/LiffAuthProvider';
export default useLiffAuth;
