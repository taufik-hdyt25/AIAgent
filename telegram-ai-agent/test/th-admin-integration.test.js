import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/web-server.js", import.meta.url), "utf8");

test("TH Admin integration exposes authenticated generation and health routes", () => {
  assert.match(source, /\/api\/ai-generate/);
  assert.match(source, /\/api\/ai-generate\/health/);
  assert.doesNotMatch(source, /\/api\/integrations\/th-admin\/(?:generate|health)/);
  assert.match(source, /TH_ADMIN_AGENT_API_KEY/);
  assert.match(source, /timingSafeEqual/);
  assert.match(source, /TH_ADMIN_AGENT_API_KEY_FILE/);
  assert.match(source, /TH_ADMIN_ALLOWED_IPS/);
});

test("TH Admin integration limits payloads, requests and generation time", () => {
  assert.match(source, /TH_ADMIN_BODY_MAX/);
  assert.match(source, /TH_ADMIN_RATE_MAX/);
  assert.match(source, /TH_ADMIN_AGENT_TIMEOUT_MS/);
});

test("product research API provides secured Play Store, persistence, and AI analysis routes", () => {
  assert.match(source, /\/api\/product-research\/candidates/);
  assert.match(source, /\/api\/product-research\/candidate/);
  assert.match(source, /\/api\/product-research\/analyze/);
  assert.match(source, /PRODUCT_RESEARCH_RATE_LIMITS/);
  assert.match(source, /safeEqualSecret\(supplied, expectedKey\)/);
  assert.match(source, /authExempt\s*=\s*[^;]*pathname\.startsWith\("\/api\/product-research"\)/);
  assert.match(source, /researchId/);
});

test("TH Admin integration scopes outputs and avoids reporting generated content", () => {
  assert.match(source, /shortDescription/);
  assert.match(source, /privacy_policy/);
  assert.match(source, /terms_of_service/);
  assert.match(source, /shortDescription: \{ min: 80, max: 500 \}/);
  assert.match(source, /fullDescription: \{ min: 250, max: 12_000 \}/);
  assert.match(source, /legalDocument: \{ min: 500, max: 40_000 \}/);
  assert.match(source, /status=ok id=/);
});
