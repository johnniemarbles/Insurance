// ==============================================================================
// k6 Load & Concurrency Test: PII Platform
// Validates p95 latency (<400ms) and error rate (<1%) under concurrent broker load
// ==============================================================================
import http from 'k6/http';
import { check, sleep } from 'k6';

const BASE_URL = __ENV.TARGET_URL || 'http://127.0.0.1:3199';
const TEST_USER = __ENV.TEST_USER || 'sanjeev@uat.test';
const DURATION = __ENV.DURATION || '30s';
const VUS = parseInt(__ENV.VUS || '10', 10);

export const options = {
  stages: [
    { duration: '5s', target: VUS },
    { duration: DURATION, target: VUS },
    { duration: '5s', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(95)<400'], // 95% of requests under 400ms
    http_req_failed: ['rate<0.01'],   // Error rate under 1%
  },
};

export default function () {
  const headers = {
    'x-dev-user-email': TEST_USER,
    'Content-Type': 'application/json',
  };

  // 1. Health probe
  const healthRes = http.get(`${BASE_URL}/healthz`);
  check(healthRes, {
    'healthz status is 200': (r) => r.status === 200,
  });

  // 2. Navigation and active user role
  const navRes = http.get(`${BASE_URL}/v1/nav`, { headers });
  check(navRes, {
    'nav status is 200': (r) => r.status === 200,
  });

  // 3. Pipelines
  const pipeRes = http.get(`${BASE_URL}/v1/pipelines`, { headers });
  check(pipeRes, {
    'pipelines status is 200': (r) => r.status === 200,
  });

  // 4. Contacts list
  const contactsRes = http.get(`${BASE_URL}/v1/contacts?limit=20`, { headers });
  check(contactsRes, {
    'contacts status is 200': (r) => r.status === 200,
  });

  sleep(0.2);
}
