import assert from "node:assert/strict";
import { existsSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

function bashExecutable() {
  if (process.platform !== "win32") return "bash";
  const probe = spawnSync("git", ["--exec-path"], { encoding: "utf8", windowsHide: true });
  if (probe.status !== 0) return null;
  const candidate = resolve(probe.stdout.trim(), "../../..", "bin", "bash.exe");
  return existsSync(candidate) ? candidate : null;
}

const bash = bashExecutable();

function invoke(root, site, archive) {
  return spawnSync(bash, ["scripts/package-pages-artifact.sh", relative(root, site), relative(root, archive)], {
    cwd: root,
    encoding: "utf8",
    windowsHide: true,
  });
}

test("Pages tar packaging preserves reviewed dotfiles and rejects links", { skip: !bash }, () => {
  const root = mkdtempSync(join(process.cwd(), ".pages-artifact-test-"));
  try {
    const site = join(root, "site");
    mkdirSync(join(site, "nested"), { recursive: true });
    mkdirSync(join(site, ".well-known"));
    writeFileSync(join(site, "index.html"), "<!doctype html><title>Pages</title>", "utf8");
    writeFileSync(join(site, ".nojekyll"), "", "utf8");
    writeFileSync(join(site, "nested", "asset.txt"), "exact bytes", "utf8");
    writeFileSync(join(site, ".well-known", "proof.txt"), "reviewed hidden file", "utf8");
    const archive = join(root, "artifact.tar");
    const packed = invoke(process.cwd(), site, archive);
    assert.equal(packed.status, 0, `${packed.stdout}\n${packed.stderr}`);
    const listed = spawnSync(bash, ["-lc", `tar -tf '${relative(process.cwd(), archive).replaceAll("\\", "/")}'`], {
      cwd: process.cwd(), encoding: "utf8", windowsHide: true,
    });
    assert.equal(listed.status, 0, listed.stderr);
    assert.match(listed.stdout, /^\.\/\.nojekyll$/m);
    assert.match(listed.stdout, /^\.\/nested\/asset\.txt$/m);
    assert.match(listed.stdout, /^\.\/\.well-known\/proof\.txt$/m);

    const hardlinkSite = join(root, "hardlink-site");
    mkdirSync(hardlinkSite);
    writeFileSync(join(hardlinkSite, "one.txt"), "shared", "utf8");
    linkSync(join(hardlinkSite, "one.txt"), join(hardlinkSite, "two.txt"));
    const hardlink = invoke(process.cwd(), hardlinkSite, join(root, "hardlink.tar"));
    assert.notEqual(hardlink.status, 0);
    assert.match(`${hardlink.stdout}\n${hardlink.stderr}`, /hard-linked file/);

    if (process.platform !== "win32") {
      const symlinkSite = join(root, "symlink-site");
      mkdirSync(symlinkSite);
      writeFileSync(join(symlinkSite, "target.txt"), "target", "utf8");
      symlinkSync("target.txt", join(symlinkSite, "alias.txt"));
      const linked = invoke(process.cwd(), symlinkSite, join(root, "symlink.tar"));
      assert.notEqual(linked.status, 0);
      assert.match(`${linked.stdout}\n${linked.stderr}`, /symbolic link/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
