// バックログ B-06: 性能・負荷試験（NFR-02: 100同時接続、p95検証）
// 実行には k6 (https://k6.io) が必要。ローカル/CIどちらでも使えるが、
// CIでの実行は .github/workflows/load-test.yml から workflow_dispatch で手動起動する想定。
//
// 使い方:
//   BASE_URL=http://localhost:8790 DEMO_USER_ID=user-director-1 k6 run scripts/load/k6-smoke.js
import http from "k6/http";
import { check, sleep } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8790";
const DEMO_USER_ID = __ENV.DEMO_USER_ID || "user-director-1";

export const options = {
  scenarios: {
    concurrent_read: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 100),
      duration: __ENV.DURATION || "30s",
    },
  },
  thresholds: {
    // NFR-02: 一般操作 p95 <= 2秒、検索 p95 <= 3秒
    "http_req_duration{endpoint:general}": ["p(95)<2000"],
    "http_req_duration{endpoint:search}": ["p(95)<3000"],
    http_req_failed: ["rate<0.01"],
  },
};

function login() {
  const res = http.post(`${BASE_URL}/api/auth/login`, JSON.stringify({ userId: DEMO_USER_ID }), {
    headers: { "content-type": "application/json" },
    tags: { endpoint: "general" },
  });
  check(res, { "login 200": (r) => r.status === 200 });
  return res.json("token");
}

export default function () {
  const token = login();
  const headers = { authorization: `Bearer ${token}` };

  const dashboard = http.get(`${BASE_URL}/api/dashboard/kpis`, { headers, tags: { endpoint: "general" } });
  check(dashboard, { "dashboard 200": (r) => r.status === 200 });

  const search = http.get(`${BASE_URL}/api/search?q=%E8%AD%B0%E6%A1%88`, { headers, tags: { endpoint: "search" } });
  check(search, { "search 200": (r) => r.status === 200 });

  sleep(1);
}
