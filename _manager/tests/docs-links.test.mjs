import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const activeDocs = [
  "README.md",
  "PROJECT.md",
  "AGENTS.md",
  "app/AGENTS.md",
  "web/README.md",
  "web/AGENTS.md",
  "_manager/README.md",
  "_manager/THREADS.md",
  "_manager/HANDOFF_TEMPLATE.md",
  "_manager/RELEASES.md",
  "_manager/RELEASE_MANIFEST_TEMPLATE.md",
  "_manager/templates/web/SERVER_HANDOFF.md",
  "_manager/templates/web/DEPLOYMENT_CHECKLIST.md",
];

test("relative Markdown links in active project docs resolve after migration", () => {
  const broken = [];
  for (const name of activeDocs) {
    const file = resolve(root, name);
    const source = readFileSync(file, "utf8");
    for (const match of source.matchAll(/!?\[[^\]]*\]\(([^)]+)\)/g)) {
      const target = match[1].split("#")[0].trim();
      if (!target || /^(?:https?:|mailto:|data:|\/)/i.test(target)) continue;
      const decoded = decodeURIComponent(target.replace(/^<|>$/g, ""));
      if (!existsSync(resolve(dirname(file), decoded))) broken.push(name + " -> " + decoded);
    }
  }
  assert.deepEqual(broken, []);
});
