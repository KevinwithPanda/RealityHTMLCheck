import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { validateProjectConfig } from "../realitycheck/scripts/config.mjs";
import { validateArtifactFiles } from "../realitycheck/scripts/artifact-validator.mjs";
import { PROFILE_NAMES, buildProjectProfile, formatProfileList } from "../realitycheck/scripts/profiles.mjs";

const CLI = resolve("realitycheck/scripts/audit.mjs");
const SCHEMA = "./node_modules/realitycheck-web-audit/realitycheck/assets/config.schema.json";

test("starter, product, and strict profiles are valid independent project policies", () => {
  assert.deepEqual(PROFILE_NAMES, ["starter", "product", "strict"]);
  const profiles = PROFILE_NAMES.map((name) => buildProjectProfile(name, { baseUrl: "http://127.0.0.1:4300/app", schema: SCHEMA }));
  profiles.forEach((profile) => validateProjectConfig(profile, "generated profile"));
  assert.equal(profiles[0].mode, "quick");
  assert.equal(profiles[0].links.maxChecked, 25);
  assert.equal(profiles[0].metadata.requireViewport, true);
  assert.equal(profiles[1].mode, "deep");
  assert.equal(profiles[1].crawl.enabled, true);
  assert.equal(profiles[1].qualityGate.minimumScore, 90);
  assert.equal(profiles[1].metadata.requireCanonical, true);
  assert.equal(profiles[2].failOn, "minor");
  assert.equal(profiles[2].qualityGate.maxWaivedFindings, 0);
  const temporary = mkdtempSync(join(tmpdir(), "realitycheck-profile-schema-"));
  try {
    const paths = profiles.map((profile, index) => {
      const path = join(temporary, `${PROFILE_NAMES[index]}.config.json`);
      writeFileSync(path, `${JSON.stringify(profile, null, 2)}\n`, "utf8");
      return path;
    });
    for (const result of validateArtifactFiles(paths)) assert.equal(result.valid, true, result.errors.join("\n"));
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
  profiles[0].crawl.exclude.push("/local-change/**");
  assert.equal(profiles[1].crawl.exclude.includes("/local-change/**"), false);
});

test("profile inputs reject ambiguous or secret-bearing base URLs", () => {
  assert.throws(() => buildProjectProfile("unknown", { schema: SCHEMA }), /choose starter, product, strict/);
  assert.throws(() => buildProjectProfile("starter", { baseUrl: "file:///tmp/site", schema: SCHEMA }), /HTTP or HTTPS/);
  assert.throws(() => buildProjectProfile("starter", { baseUrl: "https://user:secret@example.com", schema: SCHEMA }), /credentials/);
  assert.throws(() => buildProjectProfile("starter", { baseUrl: "https://example.com/?token=secret", schema: SCHEMA }), /query string or fragment/);
  assert.match(formatProfileList(), /starter[\s\S]*product[\s\S]*strict/);
  assert.match(formatProfileList(), /快速完成第一次核查/);
});

test("CLI lists profiles and initializes a selected policy without opening a browser", () => {
  const temporary = mkdtempSync(join(tmpdir(), "realitycheck-profile-"));
  try {
    const listed = spawnSync(process.execPath, [CLI, "profiles"], { encoding: "utf8" });
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /starter/);
    assert.match(listed.stdout, /product/);
    assert.match(listed.stdout, /strict/);

    const destination = join(temporary, "realitycheck.config.json");
    const initialized = spawnSync(process.execPath, [CLI, "init", "--profile", "product", "--base-url", "http://127.0.0.1:4300/app", "--config", destination], { encoding: "utf8" });
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.match(initialized.stdout, /Profile: product/);
    const value = JSON.parse(readFileSync(destination, "utf8"));
    assert.equal(value.baseUrl, "http://127.0.0.1:4300/app");
    assert.equal(value.mode, "deep");
    assert.equal(value.network.maxHttpErrors, 0);
    assert.equal(value.links.maxFailures, 0);
    assert.equal(value.security.secureForms, true);

    const refused = spawnSync(process.execPath, [CLI, "init", "--profile", "unknown", "--config", join(temporary, "bad.json")], { encoding: "utf8" });
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /Unknown profile/);
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
});
