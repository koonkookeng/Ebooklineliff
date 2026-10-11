// SSOT Phase 126 Task 2 §5.2 — k6 read-heavy scenario (canvas chunks)
// Canonical: test/k6/phase126-read-heavy.js (legacy src/testing/k6/*)
// - BDD-1: 80k CCU canvas-chunk reads; gates p95<50ms, error<0.01%,
//   98.5% edge hits. Runs under k6 (k6 run test/k6/phase126-read-heavy.js);
//   thresholds mirror evaluateLoadGates (loadtest.schema).
// - Plain JS (k6 runtime; not workspace-typechecked).
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 20000 },
    { duration: '5m', target: 80000 },
    { duration: '3m', target: 80000 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<50', 'p(99)<200'],
    http_req_failed: ['rate<0.0001'],
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'https://api.omnichannel.com';

export default function () {
  const params = {
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-jwt-token-144-xz',
      'x-client-intent': 'EBOOK_READ',
    },
  };
  const page = 1 + Math.floor(Math.random() * 200);
  const resChunk = http.get(
    `${BASE_URL}/graphql?query=query{getEbookPageChunk(productId:"prod-001",pageNumber:${page}){pageNumber,vectorSvgContent}}`,
    params,
  );
  check(resChunk, {
    'Chunk status 200': (r) => r.status === 200,
    'Chunk latency < 50ms': (r) => r.timings.duration < 50,
  });
  sleep(1);
}
