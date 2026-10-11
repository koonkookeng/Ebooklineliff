// SSOT Phase 126 Task 2 §5.2 — k6 write-heavy scenario (slip verify burst)
// Canonical: test/k6/phase126-write-heavy.js (legacy src/testing/k6/*)
// - BDD-2: 20k CCU checkout/slip burst at 2000 TPS; every submit carries
//   an X-Idempotency-Key (Gate 9: zero double-processing). Queued (202)
//   outcomes count as success (outbox drain lane, 124).
// - Plain JS (k6 runtime; not workspace-typechecked).
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '1m', target: 5000 },
    { duration: '3m', target: 20000 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<1000'],
    http_req_failed: ['rate<0.0001'],
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'https://api.omnichannel.com';

export default function () {
  const idempotencyKey = `IDEM-${Date.now()}-${__VU}-${__ITER}`;
  const payload = JSON.stringify({
    orderId: 'c1b82a20-4e3a-4a2e-833d-1a92381eef11',
    slipImageUrl: 'https://storage.omnichannel.com/slips/test-slip.jpg',
  });
  const res = http.post(`${BASE_URL}/payment/verify-slip`, payload, {
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': idempotencyKey },
  });
  check(res, {
    'Verify accepted (200/202)': (r) => r.status === 200 || r.status === 202,
    'Queued copy on fallback': (r) =>
      r.status !== 202 || String(r.body).includes('คิว'),
  });
  sleep(1);
}
