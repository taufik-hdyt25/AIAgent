import test from "node:test";
import assert from "node:assert/strict";
import { searchPlay, getPlayApp, saveResearch, listResearch, updateResearch, deleteResearch, setProductResearchFetchForTests } from "../src/services/product-research-service.js";
import fs from "node:fs/promises";

const realFetch = globalThis.fetch;
test.afterEach(() => { globalThis.fetch = realFetch; setProductResearchFetchForTests(null); });

test("searchPlay extracts Google Play candidates and labels source data", async () => {
  setProductResearchFetchForTests(async (url) => ({ ok: true, status: 200, text: async () => String(url).includes("store/search")
    ? '<a href="/store/apps/details?id=com.test.one">One</a>'
    : '<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Test App","description":"A test listing","applicationCategory":"Finance","aggregateRating":{"ratingValue":"4.5","ratingCount":"1200"},"author":{"name":"Studio"}}</script>' }));
  const results = await searchPlay({ query: "finance", country: "US", language: "en" });
  assert.equal(results.length, 1);
  assert.equal(results[0].id, "com.test.one");
  assert.equal(results[0].rating, 4.5);
  assert.equal(results[0].reviewCount, 1200);
  assert.equal(results[0].source, "Google Play listing");
  assert.equal(results[0].installsIsEstimate, false);
});

test("Play Store URL parser extracts the app id", async () => {
  setProductResearchFetchForTests(async () => ({ ok: true, status: 200, text: async () => '<script type="application/ld+json">{"@type":"SoftwareApplication","name":"Plan","description":"Plan finances","aggregateRating":{"ratingValue":"4.2","ratingCount":"89"}}</script>' }));
  const candidate = await getPlayApp({ url: "https://play.google.com/store/apps/details?id=com.example.plan" });
  assert.equal(candidate.id, "com.example.plan");
  assert.equal(candidate.title, "Plan");
});

test("getPlayApp rejects an invalid URL", async () => {
  await assert.rejects(getPlayApp({ url: "https://example.com" }), /valid Google Play URL or appId/);
});

test("research items can be saved, updated, listed, and deleted", async () => {
  const previous = process.env.PRODUCT_RESEARCH_STORE;
  process.env.PRODUCT_RESEARCH_STORE = `/tmp/product-research-test-${process.pid}-${Date.now()}.json`;
  try {
    const created = await saveResearch({ candidate: { id: "com.example.app", title: "Example" }, plan: { mvpFeatures: ["Search"] } });
    assert.equal((await listResearch()).length, 1);
    const updated = await updateResearch(created.id, { title: "Updated", plan: { monetization: "Freemium" } });
    assert.equal(updated.title, "Updated");
    assert.equal((await listResearch())[0].plan.monetization, "Freemium");
    assert.equal(await deleteResearch(created.id), true);
    assert.equal((await listResearch()).length, 0);
  } finally {
    try { await fs.unlink(process.env.PRODUCT_RESEARCH_STORE); } catch {}
    if (previous === undefined) delete process.env.PRODUCT_RESEARCH_STORE; else process.env.PRODUCT_RESEARCH_STORE = previous;
  }
});
