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

test("TH Admin integration scopes outputs and avoids reporting generated content", () => {
  assert.match(source, /shortDescription/);
  assert.match(source, /privacy_policy/);
  assert.match(source, /terms_of_service/);
  assert.match(source, /status=ok id=/);
});
