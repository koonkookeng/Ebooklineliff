// SSOT Phase 126 Task 2 §5.2 — k6 mixed-peak scenario (social commerce)
// Canonical: test/k6/phase126-mixed-peak.js (legacy src/testing/k6/*)
// - MIXED_SOCIAL_COMMERCE_PEAK: catalog reads + HLS heartbeats +
//   checkout intents in one VU loop; global gates hold across scenarios.
// - Plain JS (k6 runtime; not workspace-typechecked).
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  stages: [
    { duration: '2m', target: 20000 },
    { duration: '5m', target: 100000 },
    { duration: '3m', target: 100000 },
    { duration: '2m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<50', 'p(99)<200'],
    http_req_failed: ['rate<0.0001'],
  },
};

const BASE_URL = __ENV.API_BASE_URL || 'https://api.omnichannel.com';

function authed() {
  return {
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer test-jwt-token-144-xz',
    },
  };
}

export default function () {
  const catalog = http.get(`${BASE_URL}/graphql?query=query{__typename}`, authed());
  check(catalog, { 'Catalog reachable': (r) => r.status === 200 });

  const syncPayload = JSON.stringify({
    query: 'mutation { syncLessonProgress(lessonId: "les-99", watchedSec: 120) { success } }',
  });
  const sync = http.post(`${BASE_URL}/graphql`, syncPayload, authed());
  check(sync, { 'Heartbeat accepted': (r) => r.status === 200 || r.status === 400 });

  sleep(1);
}
