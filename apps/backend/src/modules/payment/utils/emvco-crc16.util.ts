// SSOT Phase 013 §5.2 — EMVCo CRC16-CCITT-FALSE checksum (spec algorithm)
// Canonical: apps/backend/src/modules/payment/utils/emvco-crc16.util.ts
// (legacy src/backend/modules/payment/utils/emvco-crc16.util.ts)
// Zero-redundant: output is byte-identical to the canonical `crc16()` in
// ../services/promptpay-emv.builder.ts (asserted in test-phase013-contracts);
// this file exists so the spec's §5.1 import path resolves to a single source.

/** CRC16-CCITT-FALSE over the EMVCo payload including trailing "6304". Uppercase hex. */
export function calculateCRC16(data: string): string {
  let crc = 0xffff;
  for (let i = 0; i < data.length; i++) {
    let x = ((crc >> 8) ^ data.charCodeAt(i)) & 0xff;
    x ^= x >> 4;
    crc = ((crc << 8) ^ (x << 12) ^ (x << 5) ^ x) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}
