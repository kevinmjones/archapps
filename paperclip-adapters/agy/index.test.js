import assert from "node:assert/strict";
import test from "node:test";
import { buildAgyModels, listAgyModels, parseAgyModels } from "./index.js";

test("static fallback excludes legacy ids and matches current 3.6 labels", () => {
  const ids = buildAgyModels().map(({ id }) => id);
  assert.equal(ids.includes("gemini-3.5-flash"), false);
  assert.equal(ids.some((id) => id.includes("Gemini 3.5 Flash")), false);
  assert.equal(ids.filter((id) => id.includes("Gemini 3.6 Flash")).length, 3);
});

test("parser converts the authoritative CLI output to adapter models", () => {
  assert.deepEqual(parseAgyModels("Model A\nModel B\n"), [
    { id: "Model A", label: "Model A" },
    { id: "Model B", label: "Model B" },
  ]);
  assert.throws(() => parseAgyModels("\n"), /empty model catalog/);
});

test("live discovery excludes the rejected legacy model", async () => {
  const ids = (await listAgyModels()).map(({ id }) => id);
  assert.equal(ids.includes("gemini-3.5-flash"), false);
  assert.equal(ids.includes("Gemini 3.6 Flash (High)"), true);
});
