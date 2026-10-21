// ==============================================================================
// PII Performance Benchmark Runner (Node 22 Native)
// Generates concurrent simulated broker traffic against Fastify API endpoints.
// Measures throughput, error rate, and response latencies (p50, p95, p99).
// ==============================================================================
import { performance } from 'node:perf_hooks';

const BASE_URL = process.env.TARGET_URL || 'http://127.0.0.1:3199';
const TEST_USER = process.env.TEST_USER || 'sanjeev@uat.test';
const CONCURRENCY = parseInt(process.env.CONCURRENCY || '10', 10);
const DURATION_SEC = parseInt(process.env.DURATION_SEC || '15', 10);
const P95_THRESHOLD_MS = parseFloat(process.env.P95_THRESHOLD_MS || '400');
const MAX_ERROR_RATE = parseFloat(process.env.MAX_ERROR_RATE || '0.01');

console.log('==========================================================');
console.log('⚡ PII Enterprise Performance & Concurrency Benchmark');
console.log(`Target:      ${BASE_URL}`);
console.log(`Concurrency: ${CONCURRENCY} workers`);
console.log(`Duration:    ${DURATION_SEC}s`);
console.log(`Thresholds:  p95 < ${P95_THRESHOLD_MS}ms, error_rate < ${MAX_ERROR_RATE * 100}%`);
console.log('==========================================================\n');

const endpoints = [
  { name: 'GET /healthz', path: '/healthz', auth: false },
  { name: 'GET /v1/nav', path: '/v1/nav', auth: true },
  { name: 'GET /v1/pipelines', path: '/v1/pipelines', auth: true },
  { name: 'GET /v1/contacts', path: '/v1/contacts?limit=20', auth: true },
];

const latencies = [];
let totalRequests = 0;
let failedRequests = 0;
let running = true;

async function worker() {
  while (running) {
    const ep = endpoints[Math.floor(Math.random() * endpoints.length)];
    const headers = ep.auth
      ? { 'x-dev-user-email': TEST_USER, 'Content-Type': 'application/json' }
      : {};

    const start = performance.now();
    try {
      const res = await fetch(`${BASE_URL}${ep.path}`, { headers });
      const duration = performance.now() - start;
      totalRequests++;
      if (res.status >= 200 && res.status < 400) {
        latencies.push(duration);
      } else {
        failedRequests++;
      }
    } catch (err) {
      failedRequests++;
      totalRequests++;
    }
    // Realistic micro-pause between requests
    await new Promise((r) => setTimeout(r, 20));
  }
}

const workers = Array.from({ length: CONCURRENCY }, () => worker());

await new Promise((resolve) => setTimeout(resolve, DURATION_SEC * 1000));
running = false;
await Promise.all(workers);

latencies.sort((a, b) => a - b);
const count = latencies.length;
const p50 = count ? latencies[Math.floor(count * 0.50)] : 0;
const p90 = count ? latencies[Math.floor(count * 0.90)] : 0;
const p95 = count ? latencies[Math.floor(count * 0.95)] : 0;
const p99 = count ? latencies[Math.floor(count * 0.99)] : 0;
const errorRate = totalRequests > 0 ? failedRequests / totalRequests : 0;
const throughput = totalRequests / DURATION_SEC;

console.log('----------------------------------------------------------');
console.log('📊 Performance Benchmark Results:');
console.log(`Total Requests:  ${totalRequests}`);
console.log(`Successes:       ${count}`);
console.log(`Failures:        ${failedRequests} (${(errorRate * 100).toFixed(2)}%)`);
console.log(`Throughput:      ${throughput.toFixed(1)} req/sec`);
console.log(`Latency p50:     ${p50.toFixed(2)} ms`);
console.log(`Latency p90:     ${p90.toFixed(2)} ms`);
console.log(`Latency p95:     ${p95.toFixed(2)} ms (Threshold: < ${P95_THRESHOLD_MS} ms)`);
console.log(`Latency p99:     ${p99.toFixed(2)} ms`);
console.log('----------------------------------------------------------');

let passed = true;
if (p95 > P95_THRESHOLD_MS) {
  console.error(`❌ FAILED: p95 latency (${p95.toFixed(2)}ms) exceeded threshold (${P95_THRESHOLD_MS}ms)`);
  passed = false;
}
if (errorRate > MAX_ERROR_RATE) {
  console.error(`❌ FAILED: Error rate (${(errorRate * 100).toFixed(2)}%) exceeded threshold (${MAX_ERROR_RATE * 100}%)`);
  passed = false;
}

if (!passed) {
  process.exit(1);
}

console.log('✅ ALL PERFORMANCE THRESHOLDS MET!');
process.exit(0);
