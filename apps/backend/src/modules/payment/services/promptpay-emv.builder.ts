// SSOT Phase 012 §3.2/BDD — PromptPay EMVCo payload builder (pure, no I/O)
// Canonical: apps/backend/src/modules/payment/services/promptpay-emv.builder.ts
// Dynamic QR (tag 01 = "12") embedding exact net amount + Ref-1 (orderNumber).
// Proxy types: MOBILE (01), NATIONAL_ID (02), EWALLET (03) per BOT PromptPay spec.

export type PromptPayProxyType = 'MOBILE' | 'NATIONAL_ID' | 'EWALLET';

const PROXY_TAG: Record<PromptPayProxyType, string> = {
  MOBILE: '01',
  NATIONAL_ID: '02',
  EWALLET: '03',
};

const AID = 'A000000677010111';

function tlv(tag: string, value: string): string {
  return `${tag}${String(value.length).padStart(2, '0')}${value}`;
}

/** Normalize Thai mobile to local format (08XXXXXXXX, no +66/66 prefix). */
export function normalizeMobile(raw: string): string {
  const digits = raw.replace(/\D/g, '');
  if (digits.startsWith('66')) return `0${digits.slice(2)}`;
  return digits;
}

/** CRC16-CCITT (0xFFFF, poly 0x1021) over the payload + "6304". Uppercase hex. */
export function crc16(str: string): string {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i++) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export interface PromptPayTarget {
  proxyType: PromptPayProxyType;
  proxyValue: string;
}

/** Build a dynamic-amount PromptPay payload string (ready for QR encoding). */
export function buildPromptPayPayload(target: PromptPayTarget, amountBaht: number, ref1?: string): string {
  if (!Number.isFinite(amountBaht) || amountBaht <= 0) {
    throw new Error('PromptPay amount must be positive');
  }
  const proxy = target.proxyType === 'MOBILE' ? normalizeMobile(target.proxyValue) : target.proxyValue.replace(/\D/g, '');
  if (!proxy) throw new Error('PromptPay proxy value is required');
  const merchant = tlv('00', AID) + tlv(PROXY_TAG[target.proxyType], proxy);
  let payload = tlv('00', '01') + tlv('01', '12') + tlv('29', merchant) + tlv('53', '764');
  payload += tlv('54', amountBaht.toFixed(2));
  payload += tlv('58', 'TH');
  if (ref1) payload += tlv('62', tlv('07', ref1.slice(0, 25)));
  return `${payload}6304${crc16(`${payload}6304`)}`;
}

/** Verify a payload's trailing CRC (anti-tamper check before display). */
export function verifyPromptPayPayload(payload: string): boolean {
  if (payload.length < 8 || !payload.endsWith(payload.slice(-4))) return false;
  const body = payload.slice(0, -4);
  if (!body.endsWith('6304')) return false;
  return payload.slice(-4) === crc16(body);
}
