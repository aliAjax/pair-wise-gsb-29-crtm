/* 规则层自检（非自动化测试框架，node 直接跑）：node scripts/check-rules.mjs */
import { build } from "esbuild";
import { writeFileSync } from "node:fs";

const result = await build({
  entryPoints: ["scripts/rules-entry.ts"],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false
});
writeFileSync("scripts/.rules-bundle.mjs", result.outputFiles[0].text);
const { runChecks } = await import("./.rules-bundle.mjs");

let passed = 0;
let failed = 0;
function assert(name, cond, detail = "") {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${name} ${detail}`);
  }
}

await runChecks({ assert });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
