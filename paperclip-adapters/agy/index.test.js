import assert from "node:assert/strict";
import test from "node:test";
import { buildAgyModels, buildArgs, listAgyModels, parseAgyModels } from "./index.js";

test("permission bypass is least-privilege by default and supports an explicit override", () => {
  assert.equal(buildArgs({}, "prompt").includes("--dangerously-skip-permissions"), false);
  assert.equal(
    buildArgs({ dangerouslySkipPermissions: false }, "prompt").includes("--dangerously-skip-permissions"),
    false,
  );
  assert.equal(
    buildArgs({ dangerouslySkipPermissions: true }, "prompt").includes("--dangerously-skip-permissions"),
    true,
  );
});

test("static fallback excludes legacy ids", () => {
  const ids = buildAgyModels().map(({ id }) => id);
  assert.equal(ids.includes("gemini-3.5-flash"), false);
  assert.equal(ids.some((id) => id.includes("Gemini 3.5 Flash")), false);
});

test("parser converts the authoritative CLI output to adapter models", () => {
  assert.deepEqual(parseAgyModels("Model A\nModel B\n"), [
    { id: "Model A", label: "Model A" },
    { id: "Model B", label: "Model B" },
  ]);
  assert.throws(() => parseAgyModels("\n"), /empty model catalog/);
});

test("every declared model id is supported by the authoritative runtime", async () => {
  const runtimeIds = new Set((await listAgyModels()).map(({ id }) => id));
  const declaredIds = buildAgyModels()
    .map(({ id }) => id)
    .filter((id) => id !== "auto");

  assert.deepEqual(
    declaredIds.filter((id) => !runtimeIds.has(id)),
    [],
    "adapter declares model ids absent from `agy models`",
  );
});
