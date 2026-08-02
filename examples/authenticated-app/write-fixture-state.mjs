import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const [originValue, outputValue] = process.argv.slice(2);
if (!originValue || !outputValue) {
  console.error("usage: node write-fixture-state.mjs <origin> <output.json>");
  process.exit(2);
}

const origin = new URL(originValue);
if (!new Set(["127.0.0.1", "localhost", "::1"]).has(origin.hostname)) {
  console.error("the synthetic fixture state is restricted to loopback origins");
  process.exit(2);
}

const output = resolve(outputValue);
mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, `${JSON.stringify({
  cookies: [],
  origins: [{
    origin: origin.origin,
    localStorage: [{ name: "rc_demo_session", value: "fixture-authenticated" }],
  }],
}, null, 2)}\n`, "utf8");
console.log(output);
