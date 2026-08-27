from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Any


REPOSITORY_ROOT = Path(__file__).resolve().parents[1]
SKILL_ROOT = REPOSITORY_ROOT / "realitycheck"
REPORT_SCRIPT = SKILL_ROOT / "scripts" / "report.py"

MODULE_SPEC = importlib.util.spec_from_file_location("realitycheck_report", REPORT_SCRIPT)
assert MODULE_SPEC is not None and MODULE_SPEC.loader is not None
REPORT_MODULE = importlib.util.module_from_spec(MODULE_SPEC)
MODULE_SPEC.loader.exec_module(REPORT_MODULE)


class SkillStructureTests(unittest.TestCase):
    def test_skill_frontmatter_is_minimal_complete_and_portable(self) -> None:
        content = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        match = re.match(r"\A---\n(?P<frontmatter>.*?)\n---\n", content, re.DOTALL)
        self.assertIsNotNone(match)
        assert match is not None

        metadata = {}
        for line in match.group("frontmatter").splitlines():
            key, separator, value = line.partition(":")
            self.assertEqual(separator, ":")
            metadata[key.strip()] = value.strip()

        self.assertEqual(set(metadata), {"name", "description"})
        self.assertEqual(metadata["name"], "realitycheck")
        self.assertGreater(len(metadata["description"]), 160)
        self.assertNotIn("TODO", content)
        self.assertTrue(content.isascii(), "SKILL.md should survive locale-default validators")

    def test_interface_metadata_matches_skill(self) -> None:
        content = (SKILL_ROOT / "agents" / "openai.yaml").read_text(
            encoding="utf-8"
        )
        self.assertIn('display_name: "RealityCheck"', content)
        self.assertIn("$realitycheck", content)
        self.assertNotIn("build-realitycheck", content)

    def test_html_note_skill_supports_direct_repair_and_recheck_of_a_copy(self) -> None:
        skill = (SKILL_ROOT / "SKILL.md").read_text(encoding="utf-8")
        reference = (SKILL_ROOT / "references" / "html-notes.md").read_text(
            encoding="utf-8"
        )
        for required in (
            "note repair <file-or-directory>",
            "before report",
            "repaired HTML or folder",
            "after report",
            "Never overwrite the supplied source",
            "Do not ask the user to copy a report prompt back",
        ):
            self.assertIn(required, skill)
        self.assertIn("perform the handoff inside the same Codex task", reference)
        self.assertIn("Do not claim the repaired output is complete", reference)

    def test_required_resources_exist(self) -> None:
        required = (
            "references/test-protocol.md",
            "references/browser-adapters.md",
            "references/report-schema.md",
            "references/project-config.md",
            "references/html-notes.md",
            "scripts/audit.mjs",
            "scripts/note-analyzer.mjs",
            "scripts/note-package.mjs",
            "scripts/note-summary.mjs",
            "scripts/note-scope.mjs",
            "scripts/note-compare.mjs",
            "scripts/note-comparison-report.mjs",
            "scripts/note-check.mjs",
            "scripts/note-github-summary.mjs",
            "scripts/action-paths.mjs",
            "scripts/action-publish-result.mjs",
            "scripts/note-publish-github-summary.mjs",
            "scripts/note-publish-stage.mjs",
            "scripts/note-publish-stage-command.mjs",
            "scripts/note-deploy-verify.mjs",
            "scripts/note-deploy-browser.mjs",
            "scripts/note-deploy-report.mjs",
            "scripts/note-deploy-command.mjs",
            "scripts/demo-server.mjs",
            "scripts/github-summary.mjs",
            "scripts/policy-review.mjs",
            "scripts/issue-drafts.mjs",
            "scripts/release-decision.mjs",
            "scripts/artifact-validator.mjs",
            "scripts/evidence-attestation.mjs",
            "scripts/evidence-trust.mjs",
            "scripts/evidence-trust-report.mjs",
            "scripts/catalog.mjs",
            "scripts/risk-register.mjs",
            "scripts/policy-fingerprint.mjs",
            "scripts/config.mjs",
            "scripts/report.py",
            "scripts/site-report.mjs",
            "scripts/version.mjs",
            "assets/icon.svg",
            "assets/logo.svg",
            "assets/report.schema.json",
            "assets/config.schema.json",
            "assets/verification.schema.json",
            "assets/site-report.schema.json",
            "assets/site-verification.schema.json",
            "assets/trend.schema.json",
            "assets/catalog.schema.json",
            "assets/repair-plan.schema.json",
            "assets/latest-run.schema.json",
            "assets/evidence-manifest.schema.json",
            "assets/evidence-attestation.schema.json",
            "assets/evidence-trust.schema.json",
            "assets/evidence-trust-report.schema.json",
            "assets/risk-register.schema.json",
            "assets/policy-review.schema.json",
            "assets/issue-drafts.schema.json",
            "assets/release-decision.schema.json",
            "assets/html-note-check-bundle.schema.json",
            "assets/html-note-check-comparison.schema.json",
            "assets/html-note-publish-proof.schema.json",
            "assets/html-note-publish-receipt.schema.json",
            "assets/html-note-publish-browser-proof.schema.json",
            "assets/html-note-publish-technical-report.schema.json",
            "assets/html-note-publish-command-result.schema.json",
            "assets/html-note-publish-stage-receipt.schema.json",
            "assets/html-note-deployment-browser-proof.schema.json",
            "assets/html-note-deployment-receipt.schema.json",
            "assets/demo/index.html",
            "assets/demo/styles.css",
            "assets/demo/app.js",
            "assets/demo/api/orders.json",
        )
        for relative_path in required:
            path = SKILL_ROOT / relative_path
            self.assertTrue(path.is_file(), path)
            self.assertGreater(path.stat().st_size, 100, path)

        schema = json.loads((SKILL_ROOT / "assets" / "report.schema.json").read_text(encoding="utf-8"))
        self.assertEqual(schema["properties"]["schemaVersion"]["const"], "1")

    def test_github_action_wraps_audit_and_preserves_gate_exit_code(self) -> None:
        action = (REPOSITORY_ROOT / "action.yml").read_text(encoding="utf-8")
        self.assertIn("using: composite", action)
        self.assertIn("realitycheck/scripts/audit.mjs", action)
        self.assertIn("Preview the effective audit plan without a browser", action)
        self.assertIn("audit-plan-path", action)
        self.assertIn("plan-exit-code", action)
        self.assertIn("audit-plan.zh-CN.md", action)
        self.assertIn('RC_PLAN_EXIT_CODE" != "0', action)
        self.assertIn("actions/upload-artifact@v7", action)
        self.assertIn("Build the evidence catalog", action)
        self.assertIn("catalog-path", action)
        self.assertIn("Build the longitudinal risk register", action)
        self.assertIn("risk-register-path", action)
        self.assertIn("Sign completed evidence manifests", action)
        self.assertIn("attestation-private-key", action)

        self.assertIn("attestation-trusted-key-id", action)
        self.assertIn("attestation-count", action)
        self.assertIn("max-open-risk-age-days", action)
        self.assertIn("max-open-risks", action)
        self.assertIn("max-recurring-risks", action)
        self.assertIn("risk-exit-code", action)
        self.assertIn("evidence was preserved", action)
        self.assertIn("Evaluate evidence trust", action)
        self.assertIn("trust-policy", action)
        self.assertIn("trust-report-count", action)
        self.assertIn("trust-exit-code", action)
        self.assertIn("GITHUB_STEP_SUMMARY", action)
        self.assertIn("Publish bounded workflow annotations", action)
        self.assertIn("github-summary-path", action)
        self.assertIn("max-annotations", action)
        self.assertIn("summary-language", action)
        self.assertIn("summary-exit-code", action)
        self.assertIn("Review project policy changes", action)
        self.assertIn("policy-before", action)
        self.assertIn("policy-after", action)
        self.assertIn("policy-review-path", action)
        self.assertIn("policy-exit-code", action)
        self.assertIn("Build reviewable GitHub issue drafts", action)
        self.assertIn("issue-drafts-path", action)
        self.assertIn("github-issue-drafts.html", action)
        self.assertIn("Assemble the release decision", action)
        self.assertIn("release-required-controls", action)
        self.assertIn("release-max-age-hours", action)
        self.assertIn("release-decision-path", action)
        self.assertIn("release-decision-exit-code", action)
        self.assertIn('RC_RELEASE_EXIT_CODE" = "3', action)
        self.assertIn('exit "$web_status"', action)
        self.assertNotIn("eval ", action)

    def test_github_action_supports_a_browser_free_html_note_gate(self) -> None:
        action = (REPOSITORY_ROOT / "action.yml").read_text(encoding="utf-8")
        self.assertIn("kind:", action)
        self.assertIn("path:", action)
        self.assertIn("Run the browser-free HTML note check", action)
        self.assertIn("realitycheck/scripts/note-check.mjs", action)
        self.assertIn("realitycheck/scripts/note-github-summary.mjs", action)
        self.assertIn("realitycheck/scripts/action-paths.mjs", action)
        self.assertIn("steps.resolve.outputs.kind == 'note'", action)
        self.assertIn("steps.resolve.outputs.kind == 'web'", action)
        self.assertIn('fail_on="${RC_FAIL_ON_INPUT:-error}"', action)
        self.assertIn('output="${RC_OUTPUT_INPUT:-.realitycheck/notes}"', action)
        self.assertIn("note-report-path", action)
        self.assertIn("note-report-json-path", action)
        self.assertIn("note-comparison-path", action)
        self.assertIn("note-comparison-json-path", action)
        self.assertIn("exclude-html:", action)
        self.assertIn("RC_EXCLUDE_HTML", action)
        self.assertIn('args+=(--exclude-html "$pattern")', action)
        self.assertIn("HTML note gate failed", action)
        self.assertIn("steps.resolve.outputs.artifact-path", action)
        self.assertIn("if-no-files-found: error", action)
        self.assertNotIn('path: ${{ github.workspace }}/${{ inputs.working-directory }}', action)
        self.assertIn("normalized to operational error 2", action)
        self.assertIn('rm -f -- "$RC_OUTPUT/report.json" "$RC_OUTPUT/repair-plan.md" "$RC_OUTPUT/repair-plan.zh-CN.md" "$RC_OUTPUT/latest.html" "$RC_OUTPUT/latest.json" "$RC_OUTPUT/comparison.html" "$RC_OUTPUT/comparison.json" "$RC_OUTPUT/github-summary.md"', action)
        self.assertIn("steps.resolve.outputs.kind == 'web' || (steps.resolve.outputs.kind == 'note' && (steps.note.outputs.exit-code == '0' || steps.note.outputs.exit-code == '1'))", action)
        self.assertIn('args+=(--baseline "$RC_BASELINE")', action)
        self.assertIn("steps.note.outputs.exit-code == '0' || steps.note.outputs.exit-code == '1'", action)
        self.assertLess(action.index("Upload RealityCheck evidence"), action.index("Enforce the RealityCheck result"))

        workflow = (REPOSITORY_ROOT / ".github" / "workflows" / "validate.yml").read_text(encoding="utf-8")
        self.assertIn("Prove the HTML note Action gate and artifact handoff", workflow)
        self.assertIn("Prove the HTML note baseline does not keep known debt red", workflow)
        self.assertIn("Prove auditable HTML exclusions in the composite Action", workflow)
        self.assertIn("kind: note", workflow)
        self.assertIn("path: note-action-fixture", workflow)
        self.assertIn("baseline: .realitycheck/ci-note-action/latest.json", workflow)
        self.assertIn("exclude-html: |", workflow)
        self.assertIn('RC_ACTION_EXIT_CODE" = "1', workflow)
        self.assertIn('report["kind"] == "html-note-check-bundle"', workflow)
        self.assertIn("HTML note Action without repository dependencies", workflow)
        self.assertIn("Run the note gate without npm install", workflow)
        self.assertIn("actions/download-artifact@v8", workflow)
        self.assertIn("downloaded-note-evidence/latest.html", workflow)

    def test_github_action_supports_an_exact_verified_publish_handoff(self) -> None:
        action = (REPOSITORY_ROOT / "action.yml").read_text(encoding="utf-8")
        for required in (
            "kind is publish",
            "entry:",
            "publish-name:",
            "materialize-output:",
            'publish_run_key="action-${GITHUB_RUN_ID}-${GITHUB_RUN_ATTEMPT}"',
            "Build the exact verified publish handoff",
            "realitycheck/scripts/action-publish-result.mjs",
            "realitycheck/scripts/note-publish-github-summary.mjs",
            "--result-json",
            "mktemp -d",
            "trap cleanup_publish_result EXIT",
            "publish-ready",
            "publish-run-path",
            "publish-archive-path",
            "publish-working-copy-path",
            "publish-report-path",
            "publish-receipt-path",
            "publish-manifest-path",
            "publish-technical-report-path",
            "publish-browser-proof-path",
            "publish-checksum-path",
            "publish-deploy-content-id",
            "publish-archive-sha256",
            "publish-artifact-id",
            "publish-artifact-url",
            "publish-artifact-digest",
            "publish-directory-path",
            "publish-stage-receipt-path",
            "Materialize the exact verified publish directory",
            "Upload the exact RealityCheck publish run",
            "compression-level: 0",
            "full HTML/site bytes",
            "Action never deploys",
            "Validated repair plan",
            "RC_PUBLISH_UPLOAD_OUTCOME",
        ):
            self.assertIn(required, action)
        self.assertIn("steps.resolve.outputs.kind == 'web' || steps.resolve.outputs.kind == 'publish'", action)
        self.assertIn("Publish mode does not accept fail-on, baseline, exclude-html, url, or config", action)
        self.assertIn("Publish mode does not accept allow-remote", action)
        self.assertIn("value: ${{ steps.publish.outputs.publish-status }}", action)
        self.assertIn("value: ${{ steps.publish.outputs.run-directory }}", action)
        self.assertIn("64-character lowercase SHA-256 hex", action)
        self.assertIn("RC_REPAIR_PLAN: ${{ steps.publish.outputs.repair-plan-path-absolute }}", action)
        self.assertLess(action.index("Upload the exact RealityCheck publish run"), action.index("Enforce the RealityCheck result"))
        workflow = (REPOSITORY_ROOT / ".github" / "workflows" / "validate.yml").read_text(encoding="utf-8")
        for required in (
            "Verified publish Action and exact Artifact round trip",
            "Build and upload one exact verified publish run",
            "Download the verified publish Artifact",
            "Revalidate the verified Action outputs and downloaded bytes",
            "Build a blocked working copy without executing its script",
            "Download the blocked working-copy Artifact",
            "realitycheck-publish-action-ready",
            "realitycheck-publish-action-blocked",
            "publish-artifact-digest",
            "browser-final-archive",
            "active-script",
            "^[0-9a-f]{64}$",
            "materialize-output: .realitycheck/pages-ready",
            "publish-stage-receipt-path",
        ):
            self.assertIn(required, workflow)

    def test_validation_workflow_waits_for_the_browser_fixture_without_hiding_startup_errors(self) -> None:
        workflow = (REPOSITORY_ROOT / ".github" / "workflows" / "validate.yml").read_text(encoding="utf-8")
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("--retry-connrefused", workflow)
        self.assertIn('cat "$lab_log"', workflow)
        self.assertIn("trap cleanup_lab EXIT", workflow)

    def test_validation_workflow_proves_the_packed_cli_from_an_isolated_consumer(self) -> None:
        workflow = (REPOSITORY_ROOT / ".github" / "workflows" / "validate.yml").read_text(encoding="utf-8")
        self.assertIn("Prove the packed CLI from an isolated consumer", workflow)
        self.assertIn('npm install --ignore-scripts "$package_path"', workflow)
        self.assertIn('cli="./node_modules/.bin/realityhtmlcheck"', workflow)
        self.assertIn('config["$schema"] == "./node_modules/realityhtmlcheck/realitycheck/assets/config.schema.json"', workflow)
        self.assertIn('plan["target"]["inspected"] is False', workflow)
        self.assertIn('"$cli" note note-fixture', workflow)
        self.assertIn('note["kind"] == "html-note-check-bundle"', workflow)
        self.assertIn('note["privacy"] == {"uploaded": False, "absolutePathsPersisted": False}', workflow)

    def test_version_and_release_metadata_agree(self) -> None:
        version = (REPOSITORY_ROOT / "VERSION").read_text(encoding="utf-8").strip()
        self.assertEqual(version, REPORT_MODULE.TOOL_VERSION)
        package = json.loads(
            (REPOSITORY_ROOT / "package.json").read_text(encoding="utf-8")
        )
        package_lock = json.loads(
            (REPOSITORY_ROOT / "package-lock.json").read_text(encoding="utf-8")
        )
        self.assertEqual(package["version"], version)
        self.assertEqual(package_lock["version"], version)
        self.assertEqual(package_lock["packages"][""]["version"], version)
        changelog = (REPOSITORY_ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        self.assertIn(f"## [{version}]", changelog)

    def test_installer_has_a_non_mutating_dry_run(self) -> None:
        installer = REPOSITORY_ROOT / "scripts" / "install-skill.py"
        result = subprocess.run(
            [sys.executable, str(installer), "--dry-run"],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("dry run; no files changed", result.stdout)
        self.assertIn("skills", result.stdout)

    def test_installer_status_distinguishes_current_and_changed_copies(self) -> None:
        installer = REPOSITORY_ROOT / "scripts" / "install-skill.py"
        with tempfile.TemporaryDirectory() as temporary_directory:
            environment = {**os.environ, "CODEX_HOME": temporary_directory}
            installed = subprocess.run(
                [sys.executable, str(installer)], check=False, capture_output=True,
                text=True, encoding="utf-8", errors="replace", env=environment,
            )
            self.assertEqual(installed.returncode, 0, installed.stderr)
            current = subprocess.run(
                [sys.executable, str(installer), "--status"], check=False,
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                env=environment,
            )
            self.assertEqual(current.returncode, 0, current.stderr)
            self.assertIn("installed and current", current.stdout)
            installed_skill = Path(temporary_directory) / "skills" / "realitycheck" / "SKILL.md"
            installed_skill.write_text(installed_skill.read_text(encoding="utf-8") + "\n", encoding="utf-8")
            changed = subprocess.run(
                [sys.executable, str(installer), "--status"], check=False,
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                env=environment,
            )
            self.assertEqual(changed.returncode, 1)
            self.assertIn("different from this repository", changed.stdout)

    def test_installed_skill_runs_note_check_without_repository_node_modules(self) -> None:
        installer = REPOSITORY_ROOT / "scripts" / "install-skill.py"
        with tempfile.TemporaryDirectory() as temporary_directory:
            root = Path(temporary_directory)
            environment = {**os.environ, "CODEX_HOME": str(root)}
            installed = subprocess.run(
                [sys.executable, str(installer)], check=False, capture_output=True,
                text=True, encoding="utf-8", errors="replace", env=environment,
            )
            self.assertEqual(installed.returncode, 0, installed.stderr)
            note = root / "note.html"
            note.write_text(
                '<!doctype html><html lang="en"><head><meta charset="utf-8">'
                '<meta name="viewport" content="width=device-width"><title>Installed skill</title>'
                '</head><body style="color: #222"><h1>Installed skill</h1><p>This portable note proves that the '
                'installed Skill can run without repository dependencies.</p></body></html>',
                encoding="utf-8",
            )
            script = root / "skills" / "realitycheck" / "scripts" / "note-check.mjs"
            output = root / "evidence"
            node_executable = shutil.which("node") or os.environ.get("REALITYCHECK_NODE")
            self.assertIsNotNone(node_executable, "Node executable is required for the installed-Skill smoke test")
            checked = subprocess.run(
                [str(node_executable), str(script), str(note), "--output", str(output), "--language", "en"],
                check=False, capture_output=True, text=True, encoding="utf-8", errors="replace",
                cwd=root, env={**environment, "NODE_PATH": ""},
            )
            self.assertEqual(checked.returncode, 0, checked.stderr)
            self.assertIn("Checked 1 HTML note(s):", checked.stdout)
            self.assertNotIn("ERR_MODULE_NOT_FOUND", checked.stderr)
            self.assertTrue((output / "latest.html").is_file())

    def test_installer_keeps_backups_outside_the_discoverable_skills_directory(self) -> None:
        installer = REPOSITORY_ROOT / "scripts" / "install-skill.py"
        with tempfile.TemporaryDirectory() as temporary_directory:
            environment = {**os.environ, "CODEX_HOME": temporary_directory}
            for _ in range(2):
                installed = subprocess.run(
                    [sys.executable, str(installer)], check=False, capture_output=True,
                    text=True, encoding="utf-8", errors="replace", env=environment,
                )
                self.assertEqual(installed.returncode, 0, installed.stderr)

            skills = Path(temporary_directory) / "skills"
            self.assertEqual([path.name for path in skills.iterdir()], ["realitycheck"])
            backups = list(
                (Path(temporary_directory) / "skill-backups" / "realitycheck").glob(
                    "realitycheck.backup-*"
                )
            )
            self.assertEqual(len(backups), 1)
            self.assertTrue((backups[0] / "SKILL.md").is_file())

    def test_installer_migrates_legacy_discoverable_backups(self) -> None:
        installer = REPOSITORY_ROOT / "scripts" / "install-skill.py"
        with tempfile.TemporaryDirectory() as temporary_directory:
            environment = {**os.environ, "CODEX_HOME": temporary_directory}
            first = subprocess.run(
                [sys.executable, str(installer)], check=False, capture_output=True,
                text=True, encoding="utf-8", errors="replace", env=environment,
            )
            self.assertEqual(first.returncode, 0, first.stderr)
            legacy = Path(temporary_directory) / "skills" / "realitycheck.backup-legacy"
            shutil.copytree(Path(temporary_directory) / "skills" / "realitycheck", legacy)

            status = subprocess.run(
                [sys.executable, str(installer), "--status"], check=False,
                capture_output=True, text=True, encoding="utf-8", errors="replace",
                env=environment,
            )
            self.assertEqual(status.returncode, 1)
            self.assertIn("duplicate skills", status.stdout)

            migrated = subprocess.run(
                [sys.executable, str(installer)], check=False, capture_output=True,
                text=True, encoding="utf-8", errors="replace", env=environment,
            )
            self.assertEqual(migrated.returncode, 0, migrated.stderr)
            self.assertFalse(legacy.exists())
            migrated_backup = (
                Path(temporary_directory)
                / "skill-backups"
                / "realitycheck"
                / "realitycheck.backup-legacy"
            )
            self.assertTrue((migrated_backup / "SKILL.md").is_file())

    def test_svg_assets_are_well_formed(self) -> None:
        svg_paths = (
            SKILL_ROOT / "assets" / "icon.svg",
            SKILL_ROOT / "assets" / "logo.svg",
            REPOSITORY_ROOT / "docs" / "assets" / "hero.svg",
            REPOSITORY_ROOT / "docs" / "assets" / "social-preview.svg",
        )
        for path in svg_paths:
            root = ET.fromstring(path.read_text(encoding="utf-8"))
            self.assertTrue(root.tag.endswith("svg"), path)

    def test_local_markdown_links_resolve(self) -> None:
        markdown_files = (
            REPOSITORY_ROOT / "README.md",
            REPOSITORY_ROOT / "docs" / "README.zh-CN.md",
        )
        link_pattern = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
        for markdown_path in markdown_files:
            content = markdown_path.read_text(encoding="utf-8")
            for target in link_pattern.findall(content):
                if target.startswith(("http://", "https://", "#")):
                    continue
                target_path = target.split("#", 1)[0]
                resolved = (markdown_path.parent / target_path).resolve()
                self.assertTrue(resolved.exists(), f"{markdown_path}: {target}")

    def test_demo_is_self_contained_and_intentionally_broken(self) -> None:
        demo = REPOSITORY_ROOT / "examples" / "demo-broken"
        html_content = (demo / "index.html").read_text(encoding="utf-8")
        css_content = (demo / "styles.css").read_text(encoding="utf-8")
        self.assertNotRegex(html_content, r"(?:src|href)=['\"]https?://")
        self.assertIn("INTENTIONALLY BROKEN DEMO", html_content)
        self.assertIn("min-width: 1040px", css_content)
        self.assertIn('data-testid="checkout"', html_content)
        self.assertTrue((demo / "api" / "orders.json").is_file())
        bundled = SKILL_ROOT / "assets" / "demo"
        bundled_html = (bundled / "index.html").read_text(encoding="utf-8")
        bundled_css = (bundled / "styles.css").read_text(encoding="utf-8")
        bundled_server = (SKILL_ROOT / "scripts" / "demo-server.mjs").read_text(encoding="utf-8")
        self.assertNotRegex(bundled_html, r"(?:src|href)=['\"]https?://")
        self.assertIn("INTENTIONALLY BROKEN", bundled_html)
        self.assertIn("min-width:1040px", bundled_css)
        self.assertIn('"127.0.0.1"', bundled_server)
        self.assertIn('new Set(["GET", "HEAD"])', bundled_server)

    def test_fixed_demo_is_a_positive_detector_fixture(self) -> None:
        demo = REPOSITORY_ROOT / "examples" / "demo-fixed"
        html_content = (demo / "index.html").read_text(encoding="utf-8")
        css_content = (demo / "styles.css").read_text(encoding="utf-8")
        script_content = (demo / "app.js").read_text(encoding="utf-8")
        self.assertIn("VERIFIED RESPONSIVE FIXTURE", html_content)
        self.assertIn('alt=""', html_content)
        self.assertIn("margin-inline-start", css_content)
        self.assertIn(":focus-visible", css_content)
        self.assertIn("overflow-wrap: anywhere", css_content)
        self.assertNotIn("min-width: 1040px", css_content)
        self.assertNotIn("simulated analytics initialization failure", script_content)
        self.assertIn("No orders need attention", script_content)

    def test_authenticated_fixture_is_synthetic_and_loopback_only(self) -> None:
        fixture = REPOSITORY_ROOT / "examples" / "authenticated-app"
        html_content = (fixture / "index.html").read_text(encoding="utf-8")
        writer = (fixture / "write-fixture-state.mjs").read_text(encoding="utf-8")
        config = json.loads((fixture / "realitycheck.config.json").read_text(encoding="utf-8"))
        self.assertIn("rc_demo_session", html_content)
        self.assertIn("fixture-authenticated", writer)
        self.assertIn("loopback", writer)
        self.assertNotRegex(html_content, r"(?:src|href)=['\"]https?://")
        self.assertEqual(config["checks"][0]["id"], "admin-panel-visible")

    def test_accessibility_basics_have_paired_negative_and_positive_fixtures(self) -> None:
        fixture = REPOSITORY_ROOT / "examples" / "accessibility-lab"
        broken = (fixture / "broken.html").read_text(encoding="utf-8")
        fixed = (fixture / "fixed.html").read_text(encoding="utf-8")
        self.assertRegex(broken, r"<html>")
        self.assertIn("<title></title>", broken)
        self.assertEqual(broken.count('id="metric"'), 2)
        self.assertIn("<h3 id=", broken)
        self.assertIn('aria-hidden="true"', broken)
        self.assertIn('<html lang="en">', fixed)
        self.assertIn("Accessibility Basics</title>", fixed)
        self.assertEqual(fixed.count('id="metric"'), 0)
        self.assertIn('aria-label="More workspace options"', fixed)

    def test_network_policy_has_paired_failure_and_recovery_fixtures(self) -> None:
        fixture = REPOSITORY_ROOT / "examples" / "network-lab"
        broken_script = (fixture / "broken.js").read_text(encoding="utf-8")
        fixed_script = (fixture / "fixed.js").read_text(encoding="utf-8")
        broken_config = json.loads((fixture / "broken.config.json").read_text(encoding="utf-8"))
        fixed_config = json.loads((fixture / "fixed.config.json").read_text(encoding="utf-8"))
        self.assertIn("missing-orders.json", broken_script)
        self.assertIn('fetch("orders.json"', fixed_script)
        self.assertTrue((fixture / "orders.json").is_file())
        self.assertEqual(broken_config["network"], fixed_config["network"])
        self.assertEqual(broken_config["network"]["scope"], "api")
        self.assertEqual(broken_config["network"]["maxHttpErrors"], 0)
        self.assertEqual(broken_config["network"]["maxFailedRequests"], 0)

    def test_link_policy_has_paired_head_only_fixtures(self) -> None:
        fixture = REPOSITORY_ROOT / "examples" / "link-lab"
        broken = (fixture / "broken.html").read_text(encoding="utf-8")
        fixed = (fixture / "fixed.html").read_text(encoding="utf-8")
        broken_config = json.loads((fixture / "broken.config.json").read_text(encoding="utf-8"))
        fixed_config = json.loads((fixture / "fixed.config.json").read_text(encoding="utf-8"))
        self.assertIn("missing-guide.html", broken)
        self.assertNotIn("missing-guide.html", fixed)
        self.assertIn('href="/logout/account"', broken)
        self.assertTrue((fixture / "destination.html").is_file())
        self.assertEqual(broken_config["links"], fixed_config["links"])
        self.assertEqual(broken_config["links"]["maxFailures"], 0)
        self.assertNotIn("method", broken_config["links"])

    def test_safe_journey_fixture_proves_keyboard_and_url_states(self) -> None:
        fixture = REPOSITORY_ROOT / "examples" / "journey-lab"
        config = json.loads((fixture / "realitycheck.config.json").read_text(encoding="utf-8"))
        broken = json.loads((fixture / "broken.config.json").read_text(encoding="utf-8"))
        script = (fixture / "app.js").read_text(encoding="utf-8")
        actions = [step["action"] for step in config["journeys"][0]["steps"]]
        self.assertIn("press", actions)
        self.assertIn("assert-url", actions)
        press = next(step for step in config["journeys"][0]["steps"] if step["action"] == "press")
        self.assertEqual(press["key"], "ArrowRight")
        self.assertEqual(broken["journeys"][0]["steps"][0], press)
        self.assertIn('event.key === "ArrowRight"', script)
        self.assertNotIn('event.key === "Enter"', script)

    def test_metadata_policy_has_paired_private_evidence_fixtures(self) -> None:
        fixture = REPOSITORY_ROOT / "examples" / "metadata-lab"
        broken = (fixture / "broken.html").read_text(encoding="utf-8")
        fixed = (fixture / "fixed.html").read_text(encoding="utf-8")
        broken_config = json.loads((fixture / "broken.config.json").read_text(encoding="utf-8"))
        fixed_config = json.loads((fixture / "fixed.config.json").read_text(encoding="utf-8"))
        self.assertNotIn('<html lang=', broken)
        self.assertIn('<meta name="robots" content="noindex, nofollow">', broken)
        self.assertEqual(broken.count("<h1"), 2)
        self.assertIn('<html lang="en">', fixed)
        self.assertIn('<meta name="viewport" content="width=device-width,initial-scale=1">', fixed)
        self.assertIn('<link rel="canonical" href="https://docs.example.test/guides/release-readiness">', fixed)
        self.assertEqual(fixed.count("<h1"), 1)
        self.assertIn("<svg", fixed)
        self.assertEqual(fixed.count("<title>"), 2)
        self.assertEqual(broken_config["metadata"], fixed_config["metadata"])
        self.assertTrue(broken_config["metadata"]["forbidNoindex"])
        self.assertTrue(broken_config["metadata"]["requireSingleH1"])

    def test_semantic_security_headers_have_paired_private_evidence(self) -> None:
        fixture = REPOSITORY_ROOT / "examples" / "security-header-lab"
        broken_config = json.loads((fixture / "broken.config.json").read_text(encoding="utf-8"))
        fixed_config = json.loads((fixture / "fixed.config.json").read_text(encoding="utf-8"))
        self.assertEqual(broken_config["security"], fixed_config["security"])
        self.assertIn("contentSecurityPolicy", broken_config["security"]["headerPolicies"])
        server = (fixture / "server.mjs").read_text(encoding="utf-8")
        self.assertIn('"/broken"', server)
        self.assertIn('"/fixed"', server)
        for name, expected_score, expected_findings in (("security-headers-broken", 80, 4), ("security-headers-fixed", 100, 0)):
            root = REPOSITORY_ROOT / "examples" / "public-evidence" / name
            latest = json.loads((root / "latest.json").read_text(encoding="utf-8"))
            report = json.loads((root / latest["artifacts"]["json"]).read_text(encoding="utf-8"))
            semantic = [item for item in report["findings"] if item["ruleId"].startswith("security-header-policy-")]
            self.assertEqual(report["score"]["overall"], expected_score)
            self.assertEqual(len(semantic), expected_findings)
            self.assertTrue(all(item["measurements"]["rawValueRetained"] is False for item in semantic))
            serialized = json.dumps(report, ensure_ascii=False)
            self.assertNotIn("default-src 'self'", serialized)
            self.assertNotIn("frame-ancestors 'none'", serialized)
            self.assertNotIn("private.example", serialized)
            if name == "security-headers-broken":
                permissions = next(item for item in semantic if item["ruleId"].endswith("permissions-policy"))
                csp = next(item for item in semantic if item["ruleId"].endswith("content-security-policy"))
                self.assertIn("camera, geolocation", permissions["summary"])
                self.assertIn("base-uri, form-action, frame-ancestors", csp["remediation"]["summary"])
                sri = next(item for item in report["findings"] if item["ruleId"] == "security-subresource-integrity")
                self.assertEqual(sri["measurements"]["missingIntegrity"], 1)
                self.assertFalse(sri["measurements"]["resourcePathsRetained"])
                self.assertFalse(sri["measurements"]["integrityValuesRetained"])
                self.assertNotIn("asset.js", serialized)
                self.assertNotIn("sha384-", serialized)

    def test_privacy_budget_has_paired_aggregate_only_evidence(self) -> None:
        fixture = REPOSITORY_ROOT / "examples" / "privacy-lab"
        broken = (fixture / "broken.html").read_text(encoding="utf-8")
        fixed = (fixture / "fixed.html").read_text(encoding="utf-8")
        broken_config = json.loads((fixture / "broken.config.json").read_text(encoding="utf-8"))
        fixed_config = json.loads((fixture / "fixed.config.json").read_text(encoding="utf-8"))
        self.assertEqual(broken_config["privacy"], fixed_config["privacy"])
        self.assertIn("localStorage.setItem", broken)
        self.assertIn("sessionStorage.setItem", broken)
        self.assertIn("rc_consent=essential", fixed)

        evidence = REPOSITORY_ROOT / "examples" / "public-evidence" / "privacy"
        latest = json.loads((evidence / "latest.json").read_text(encoding="utf-8"))
        report = json.loads((evidence / latest["artifacts"]["json"]).read_text(encoding="utf-8"))
        self.assertEqual(report["score"]["overall"], 76)
        self.assertEqual(len(report["findings"]), 6)
        self.assertTrue(all(item["ruleId"].startswith("privacy-") for item in report["findings"]))
        self.assertEqual(
            report["findings"][0]["measurements"]["aggregate"]["cookieSummary"],
            {"available": True, "bytes": 368, "count": 4, "thirdPartyCount": 0},
        )
        serialized = json.dumps(report, ensure_ascii=False)
        for marker in ("rc_fixture_", "fixture-", "rc-local-", "local-fixture-", "rc-session-", "session-fixture-"):
            self.assertNotIn(marker, serialized)

    def test_viewport_matrix_fixture_exposes_only_the_narrow_breakpoint(self) -> None:
        fixture = REPOSITORY_ROOT / "examples" / "viewport-lab"
        broken = (fixture / "broken.html").read_text(encoding="utf-8")
        fixed = (fixture / "fixed.html").read_text(encoding="utf-8")
        styles = (fixture / "styles.css").read_text(encoding="utf-8")
        broken_config = json.loads((fixture / "broken.config.json").read_text(encoding="utf-8"))
        fixed_config = json.loads((fixture / "fixed.config.json").read_text(encoding="utf-8"))
        expected = [
            {"id": "phone-320", "width": 320, "height": 700, "touch": True},
            {"id": "phone-390", "width": 390, "height": 844, "touch": True},
            {"id": "tablet-768", "width": 768, "height": 1024, "touch": True},
        ]
        self.assertEqual(broken_config["viewports"], expected)
        self.assertEqual(fixed_config["viewports"], expected)
        self.assertIn('data-testid="release-action"', broken)
        self.assertIn('data-testid="release-action"', fixed)
        self.assertIn('<body class="broken">', broken)
        self.assertIn('<body class="fixed">', fixed)
        self.assertIn("@media (max-width: 340px)", styles)
        self.assertIn(".broken .primary", styles)
        self.assertNotIn("mobile-375", json.dumps(expected))

    def test_visual_regression_fixture_has_reviewed_baseline_and_dynamic_mask(self) -> None:
        fixture = REPOSITORY_ROOT / "examples" / "visual-regression-lab"
        approved = (fixture / "approved" / "index.html").read_text(encoding="utf-8")
        regressed = (fixture / "regressed" / "index.html").read_text(encoding="utf-8")
        config = json.loads((fixture / "realitycheck.config.json").read_text(encoding="utf-8"))
        index = json.loads((fixture / "baselines" / "visual-baseline-index.json").read_text(encoding="utf-8"))
        self.assertIn('class="current-time"', approved)
        self.assertIn('class="current-time"', regressed)
        self.assertIn("new Date().toISOString()", approved)
        self.assertEqual(config["visual"]["masks"], [".current-time"])
        self.assertEqual(config["visual"]["maxDiffRatio"], 0.002)
        self.assertEqual(len(index["entries"]), 1)
        entry = index["entries"][0]
        self.assertEqual(entry["pathname"], "/index.html")
        baseline = fixture / "baselines" / entry["filename"]
        self.assertTrue(baseline.is_file())
        self.assertEqual(entry["sha256"], f"sha256:{hashlib.sha256(baseline.read_bytes()).hexdigest()}")

    def test_governed_waiver_fixture_is_explicit_and_keeps_the_control_missing(self) -> None:
        fixture = REPOSITORY_ROOT / "examples" / "waiver-lab"
        page = (fixture / "index.html").read_text(encoding="utf-8")
        config = json.loads((fixture / "realitycheck.config.json").read_text(encoding="utf-8"))
        unwaived = json.loads((fixture / "unwaived.config.json").read_text(encoding="utf-8"))
        policy = json.loads((fixture / "policy.config.json").read_text(encoding="utf-8"))
        self.assertNotIn('data-testid="legacy-export"', page)
        self.assertEqual(config["checks"][0]["id"], "legacy-export-visible")
        self.assertEqual(config["waivers"][0]["ruleId"], "custom-legacy-export-visible")
        self.assertIn("owner", config["waivers"][0])
        self.assertRegex(config["waivers"][0]["expires"], r"^\d{4}-\d{2}-\d{2}$")
        self.assertNotIn("waivers", unwaived)
        self.assertEqual(unwaived["checks"][0]["id"], config["checks"][0]["id"])
        self.assertEqual(policy["failOn"], "never")
        self.assertEqual(policy["qualityGate"]["minimumScore"], 100)
        self.assertEqual(policy["baselinePolicy"]["maxAgeDays"], 30)
        self.assertTrue(policy["baselinePolicy"]["requireSamePolicy"])
        self.assertEqual(policy["owners"][0]["id"], "web-platform")
        self.assertEqual(policy["owners"][0]["ruleIds"], ["custom-legacy-export-visible"])


class ReportCliTests(unittest.TestCase):
    def run_cli(self, *arguments: str) -> subprocess.CompletedProcess[str]:
        return subprocess.run(
            [sys.executable, str(REPORT_SCRIPT), *arguments],
            check=False,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
        )

    def initialize(
        self,
        output: Path,
        *,
        target: str = "http://127.0.0.1:4173/?token=source-secret",
        mode: str = "quick",
        fail_on: str = "critical",
    ) -> tuple[Path, dict[str, Any]]:
        result = self.run_cli(
            "init",
            "--target",
            target,
            "--mode",
            mode,
            "--adapter",
            "codex-browser",
            "--output",
            str(output),
            "--fail-on",
            fail_on,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        input_path = Path(result.stdout.strip())
        return input_path, json.loads(input_path.read_text(encoding="utf-8"))

    @staticmethod
    def finish_scenarios(audit: dict[str, Any]) -> None:
        for scenario in audit["scenarios"]:
            scenario["status"] = "passed"
            scenario["durationMs"] = 100

    @staticmethod
    def finding(
        *,
        severity: str = "major",
        confidence: str = "high",
        classification: str = "new",
        scenario_id: str = "mobile-375",
        title: str = "Mobile control is offscreen",
        summary: str = "Bearer abc.def.ghi and <script>alert(1)</script>",
        evidence: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        return {
            "ruleId": "offscreen-critical-control",
            "scenarioId": scenario_id,
            "classification": classification,
            "severity": severity,
            "confidence": confidence,
            "title": title,
            "summary": summary,
            "url": "http://127.0.0.1:4173/checkout?session=private-value",
            "selector": "[data-testid=checkout]",
            "measurements": {
                "viewportWidth": 375,
                "elementRight": 987,
                "accessToken": "private-token",
            },
            "evidence": evidence
            or [
                {
                    "type": "dom",
                    "selector": "[data-testid=checkout]",
                    "boundingBox": {"x": 900, "y": 120, "width": 87, "height": 40},
                }
            ],
            "reproductionSteps": ["Open at a 375x812 viewport."],
            "remediation": {
                "summary": "Keep the action inside the responsive grid.",
                "technicalHints": ["Remove the fixed minimum width."],
            },
        }

    def write_audit(self, path: Path, audit: dict[str, Any]) -> None:
        path.write_text(
            json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )

    def test_init_creates_quick_template_without_secrets_in_stdout(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            output = Path(temporary_directory) / "runs"
            input_path, audit = self.initialize(output)
            self.assertTrue(input_path.is_file())
            self.assertTrue((input_path.parent / "screenshots").is_dir())
            self.assertEqual(audit["run"]["mode"], "quick")
            self.assertEqual(audit["scenarios"][0]["id"], "baseline")
            self.assertEqual(len(audit["scenarios"]), 6)
            self.assertNotIn("source-secret", str(input_path))

    def test_render_preserves_a_normalized_responsive_viewport_matrix(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(Path(temporary_directory) / "runs")
            self.finish_scenarios(audit)
            audit["config"]["viewports"] = [
                {"id": "phone-320", "width": 320, "height": 700, "touch": True},
                {"id": "tablet-768", "width": 768, "height": 1024, "touch": False},
            ]
            self.write_audit(input_path, audit)

            rendered = self.run_cli("render", str(input_path))
            self.assertEqual(rendered.returncode, 0, rendered.stderr)
            report = json.loads((input_path.parent / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["config"]["viewports"], audit["config"]["viewports"])

    def test_remote_target_requires_explicit_authorization(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            rejected = self.run_cli(
                "init",
                "--target",
                "https://example.com",
                "--adapter",
                "codex-browser",
                "--output",
                temporary_directory,
            )
            self.assertEqual(rejected.returncode, 2)
            self.assertIn("--allow-remote", rejected.stderr)

            allowed = self.run_cli(
                "init",
                "--target",
                "https://example.com",
                "--allow-remote",
                "--adapter",
                "codex-browser",
                "--output",
                temporary_directory,
            )
            self.assertEqual(allowed.returncode, 0, allowed.stderr)

    def test_reserved_local_hostname_is_allowed(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            local = self.run_cli(
                "init",
                "--target",
                "http://dashboard.test:4173",
                "--adapter",
                "codex-browser",
                "--output",
                temporary_directory,
            )
            self.assertEqual(local.returncode, 0, local.stderr)

    def test_redaction_does_not_hide_unrelated_key_substrings(self) -> None:
        self.assertFalse(REPORT_MODULE.is_sensitive_name("keyboardReachable"))
        self.assertFalse(REPORT_MODULE.is_sensitive_name("monkeyScenario"))
        self.assertTrue(REPORT_MODULE.is_sensitive_name("accessToken"))
        self.assertTrue(REPORT_MODULE.is_sensitive_name("csrf_token"))

    def test_render_scores_redacts_escapes_and_enforces_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(
                Path(temporary_directory) / "runs", fail_on="major"
            )
            self.finish_scenarios(audit)
            audit["target"]["title"] = "Demo <script>"
            audit["adapter"]["capabilities"] = ["screenshots", "viewport"]
            existing = self.finding(
                severity="minor",
                classification="existing",
                scenario_id="baseline",
                title="Existing clipping",
            )
            existing["ruleId"] = "element-text-clipping"
            existing["selector"] = "[data-testid=customer-name]"
            audit["findings"] = [
                self.finding(),
                existing,
                self.finding(
                    severity="major",
                    confidence="low",
                    scenario_id="keyboard-tab",
                    title="Ambiguous focus indicator",
                ),
            ]
            audit["scenarios"][1]["status"] = "completed-with-findings"
            self.write_audit(input_path, audit)

            rendered = self.run_cli("render", str(input_path))
            self.assertEqual(rendered.returncode, 1, rendered.stderr)
            report_path = input_path.parent / "report.json"
            markdown_path = input_path.parent / "report.md"
            html_path = input_path.parent / "report.html"
            repair_plan_path = input_path.parent / "repair-plan.json"
            repair_markdown_path = input_path.parent / "repair-plan.md"
            report = json.loads(report_path.read_text(encoding="utf-8"))
            markdown = markdown_path.read_text(encoding="utf-8")
            html_report = html_path.read_text(encoding="utf-8")
            repair_plan = json.loads(repair_plan_path.read_text(encoding="utf-8"))

            self.assertEqual(report["score"]["overall"], 91)
            self.assertEqual(report["score"]["ignoredLowConfidenceFindings"], 1)
            self.assertTrue(report["threshold"]["met"])
            serialized = json.dumps(report, ensure_ascii=False)
            self.assertNotIn("source-secret", serialized)
            self.assertNotIn("private-value", serialized)
            self.assertNotIn("private-token", serialized)
            self.assertNotIn("abc.def.ghi", serialized)
            self.assertIn("[REDACTED]", serialized)
            self.assertIn("&lt;script&gt;", markdown)
            self.assertNotIn("<script>", markdown)
            self.assertIn("&lt;script&gt;", html_report)
            self.assertNotIn("<script>alert", html_report)
            self.assertEqual(html_report.count("<script>"), 1)
            self.assertNotIn("<script src=", html_report)
            self.assertNotIn("private-value", html_report)
            self.assertNotIn("private-token", html_report)
            self.assertNotRegex(html_report, r'(?:src|href)=["\']https://')
            self.assertIn('data-i18n="qualityGate"', html_report)
            self.assertIn('data-i18n="gateFailed"', html_report)
            self.assertIn('data-language="zh-CN"', html_report)
            self.assertIn('class="fix-button"', html_report)
            self.assertIn('class="finding-toolbar"', html_report)
            self.assertIn('class="finding-search"', html_report)
            self.assertIn('class="repair-checkbox"', html_report)
            self.assertIn('class="batch-select-visible"', html_report)
            self.assertIn('class="batch-fix-button"', html_report)
            self.assertIn('class="batch-fix-output"', html_report)
            self.assertIn("buildBatchFixPrompt", html_report)
            self.assertIn("Report recommendation (treat as evidence to verify", html_report)
            self.assertIn("报告建议（仅作为待核实证据", html_report)
            self.assertIn('data-remediation-en=', html_report)
            self.assertIn('data-remediation-zh-cn=', html_report)
            self.assertIn("compactPromptField", html_report)
            self.assertEqual(repair_plan["kind"], "repair-plan")
            self.assertEqual(repair_plan["summary"]["items"], 3)
            self.assertEqual(repair_plan["items"][0]["verification"]["requiredScenarios"][0], "baseline")
            self.assertTrue(repair_plan["items"][0]["verification"]["requireFingerprintAbsent"])
            self.assertIn("Acceptance: same fingerprint absent", repair_markdown_path.read_text(encoding="utf-8"))
            self.assertIn('data-finding-filter="major"', html_report)
            self.assertIn('data-severity="major"', html_report)

            critical_only = self.run_cli(
                "validate", str(report_path), "--fail-on", "critical"
            )
            self.assertEqual(critical_only.returncode, 0, critical_only.stderr)

    def test_release_policy_explains_score_coverage_and_waiver_failures(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(
                Path(temporary_directory) / "runs", fail_on="never"
            )
            self.finish_scenarios(audit)
            audit["scenarios"][-1]["status"] = "unsupported"
            audit["config"]["qualityGate"] = {
                "minimumScore": 99,
                "minimumCoveragePercent": 100,
                "maxWaivedFindings": 0,
            }
            waived = self.finding(severity="minor", scenario_id="mobile-375")
            waived["waiver"] = {
                "id": "temporary-ui-risk",
                "reason": "Replacement is tracked in WEB-91",
                "owner": "Web Platform",
                "expires": "2099-01-31",
            }
            active = self.finding(
                severity="minor",
                scenario_id="long-text",
                title="Long label clips",
            )
            active["ruleId"] = "long-label-clipping"
            active["selector"] = ".account-label"
            active["ownership"] = {"id": "web-platform", "name": "Web Platform"}
            audit["findings"] = [waived, active]
            self.write_audit(input_path, audit)

            rendered = self.run_cli("render", str(input_path))
            self.assertEqual(rendered.returncode, 1, rendered.stderr)
            report = json.loads((input_path.parent / "report.json").read_text(encoding="utf-8"))
            self.assertEqual(report["score"]["overall"], 97)
            self.assertEqual(report["findings"][1]["ownership"]["name"], "Web Platform")
            self.assertEqual(report["threshold"]["coveragePercent"], 83.3)
            self.assertEqual(
                [item["code"] for item in report["threshold"]["violations"]],
                ["minimum-score", "minimum-coverage", "max-waived-findings"],
            )
            self.assertIn("policy:      minimum-score (97 vs 99)", rendered.stdout)
            html_report = (input_path.parent / "report.html").read_text(encoding="utf-8")
            markdown = (input_path.parent / "report.md").read_text(encoding="utf-8")
            self.assertIn("Why the release gate failed", html_report)
            self.assertIn("发布门禁为什么失败", html_report)
            self.assertIn("负责团队", html_report)
            self.assertIn("## Release gate reasons", markdown)
            repair_plan = json.loads((input_path.parent / "repair-plan.json").read_text(encoding="utf-8"))
            owned = next(item for item in repair_plan["items"] if item["findingId"] == report["findings"][1]["id"])
            self.assertEqual(owned["ownership"]["id"], "web-platform")
            validated = self.run_cli("validate", str(input_path.parent / "report.json"))
            self.assertEqual(validated.returncode, 1, validated.stderr)

    def test_bilingual_content_and_scoped_fix_actions_are_preserved(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(Path(temporary_directory) / "runs")
            self.finish_scenarios(audit)
            audit["target"]["title"] = "Checkout dashboard"
            audit["target"]["translations"] = {
                "zh-CN": {"title": "结账控制台"}
            }
            audit["scenarios"][1]["notes"] = ["The action moved offscreen."]
            audit["scenarios"][1]["translations"] = {
                "zh-CN": {"notes": ["主要操作移动到了屏幕外。"]}
            }
            finding = self.finding()
            finding["translations"] = {
                "zh-CN": {
                    "title": "手机端看不到主要操作",
                    "summary": "固定宽度使主要操作移动到了视口之外。",
                    "reproductionSteps": ["使用 375×812 的视口打开页面。"],
                    "remediation": {
                        "summary": "移除固定最小宽度。",
                        "technicalHints": ["使用响应式网格约束。"],
                    },
                }
            }
            audit["findings"] = [finding]
            audit["warnings"] = ["Reference warning."]
            audit["translations"] = {
                "zh-CN": {"warnings": ["参考报告警告。"]}
            }
            self.write_audit(input_path, audit)

            rendered = self.run_cli("render", str(input_path), "--fail-on", "never")
            self.assertEqual(rendered.returncode, 0, rendered.stderr)
            report = json.loads(
                (input_path.parent / "report.json").read_text(encoding="utf-8")
            )
            html_report = (input_path.parent / "report.html").read_text(
                encoding="utf-8"
            )

            self.assertEqual(
                report["findings"][0]["translations"]["zh-CN"]["title"],
                "手机端看不到主要操作",
            )
            self.assertIn("结账控制台", html_report)
            self.assertIn("主要操作移动到了屏幕外", html_report)
            self.assertIn("复制给 Codex 的修复任务", html_report)
            self.assertIn("Use $realitycheck to fix and verify", html_report)
            self.assertIn("使用 $realitycheck 修复并验证", html_report)
            self.assertIn(
                '.fix-prompt-output:not([hidden])', html_report
            )
            self.assertIn("output.value = buildFixPrompt(button)", html_report)
            self.assertIn("batchOutput.value = buildBatchFixPrompt", html_report)
            self.assertIn('languageToast?.classList.remove("visible")', html_report)
            self.assertIn('languageToast.textContent = ""', html_report)
            self.assertIn("Content-Security-Policy", html_report)

    def test_render_writes_sarif_and_junit_for_ci_platforms(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(
                Path(temporary_directory) / "runs", fail_on="major"
            )
            self.finish_scenarios(audit)
            audit["findings"] = [self.finding(severity="major")]
            audit["scenarios"][1]["status"] = "completed-with-findings"
            self.write_audit(input_path, audit)

            rendered = self.run_cli("render", str(input_path))
            self.assertEqual(rendered.returncode, 1, rendered.stderr)
            sarif = json.loads(
                (input_path.parent / "report.sarif").read_text(encoding="utf-8")
            )
            self.assertEqual(sarif["version"], "2.1.0")
            result = sarif["runs"][0]["results"][0]
            self.assertEqual(result["level"], "error")
            self.assertIn("realitycheckFingerprint/v1", result["partialFingerprints"])
            self.assertNotIn("private-value", json.dumps(sarif))

            junit_path = input_path.parent / "report.junit.xml"
            suite = ET.parse(junit_path).getroot()
            self.assertEqual(suite.tag, "testsuite")
            self.assertEqual(suite.attrib["failures"], "1")
            self.assertEqual(suite.attrib["errors"], "0")
            self.assertIsNotNone(
                suite.find("./testcase[@name='mobile-375']/failure")
            )

    def test_governed_waiver_keeps_evidence_but_excludes_gate_and_score(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(
                Path(temporary_directory) / "runs", fail_on="major"
            )
            self.finish_scenarios(audit)
            waived = self.finding(severity="major")
            waived["waiver"] = {
                "id": "legacy-checkout",
                "reason": "Replacement tracked in WEB-42",
                "owner": "Web Platform",
                "expires": "2099-01-31",
            }
            audit["findings"] = [waived]
            audit["scenarios"][1]["status"] = "completed-with-findings"
            self.write_audit(input_path, audit)

            rendered = self.run_cli("render", str(input_path))
            self.assertEqual(rendered.returncode, 0, rendered.stderr)
            report = json.loads(
                (input_path.parent / "report.json").read_text(encoding="utf-8")
            )
            self.assertEqual(report["score"]["overall"], 100)
            self.assertEqual(report["score"]["waivedFindings"], 1)
            self.assertFalse(report["threshold"]["met"])
            self.assertEqual(report["findings"][0]["waiver"]["id"], "legacy-checkout")

            html_report = (input_path.parent / "report.html").read_text(encoding="utf-8")
            self.assertIn('data-finding-filter="waived"', html_report)
            self.assertIn("Replacement tracked in WEB-42", html_report)
            sarif = json.loads(
                (input_path.parent / "report.sarif").read_text(encoding="utf-8")
            )
            self.assertEqual(sarif["runs"][0]["results"][0]["suppressions"][0]["kind"], "external")
            suite = ET.parse(input_path.parent / "report.junit.xml").getroot()
            self.assertEqual(suite.attrib["failures"], "0")
            self.assertEqual(
                REPORT_MODULE.comparison_item(report["findings"][0])["waiver"]["id"],
                "legacy-checkout",
            )

    def test_expired_finding_waiver_cannot_bypass_a_historical_run_gate(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(Path(temporary_directory) / "runs")
            self.finish_scenarios(audit)
            finding = self.finding(severity="major")
            finding["waiver"] = {
                "id": "expired-risk",
                "reason": "No longer valid",
                "expires": "2020-01-01",
            }
            audit["findings"] = [finding]
            self.write_audit(input_path, audit)
            rendered = self.run_cli("render", str(input_path))
            self.assertEqual(rendered.returncode, 2)
            self.assertIn("expired before the run started", rendered.stderr)

    def test_translation_arrays_must_match_canonical_content(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(Path(temporary_directory) / "runs")
            self.finish_scenarios(audit)
            finding = self.finding()
            finding["translations"] = {
                "zh-CN": {
                    "title": "手机端问题",
                    "summary": "操作位于视口之外。",
                    "reproductionSteps": [],
                    "remediation": {
                        "summary": "修复响应式布局。",
                        "technicalHints": ["移除固定宽度。"],
                    },
                }
            }
            audit["findings"] = [finding]
            self.write_audit(input_path, audit)

            rendered = self.run_cli("render", str(input_path), "--fail-on", "never")
            self.assertEqual(rendered.returncode, 2)
            self.assertIn("match the canonical text", rendered.stderr)

    def test_low_confidence_does_not_fail_threshold(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(Path(temporary_directory) / "runs")
            self.finish_scenarios(audit)
            audit["findings"] = [self.finding(confidence="low")]
            self.write_audit(input_path, audit)
            rendered = self.run_cli(
                "render", str(input_path), "--fail-on", "minor"
            )
            self.assertEqual(rendered.returncode, 0, rendered.stderr)

    def test_render_rejects_duplicate_finding_fingerprints(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(Path(temporary_directory) / "runs")
            self.finish_scenarios(audit)
            duplicate = self.finding()
            duplicate["id"] = "RC-DIFFERENT"
            audit["findings"] = [self.finding(), duplicate]
            self.write_audit(input_path, audit)
            rendered = self.run_cli("render", str(input_path), "--fail-on", "never")
            self.assertEqual(rendered.returncode, 2)
            self.assertIn("duplicate finding fingerprint", rendered.stderr)

    def test_render_rejects_pending_scenario(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, _ = self.initialize(Path(temporary_directory) / "runs")
            result = self.run_cli("render", str(input_path))
            self.assertEqual(result.returncode, 2)
            self.assertIn("not in a terminal state", result.stderr)

    def test_render_rejects_escaping_and_missing_screenshot_paths(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(Path(temporary_directory) / "runs")
            self.finish_scenarios(audit)
            audit["findings"] = [
                self.finding(
                    evidence=[
                        {
                            "type": "screenshot",
                            "path": "../secret.png",
                            "label": "unsafe",
                        }
                    ]
                )
            ]
            self.write_audit(input_path, audit)
            escaping = self.run_cli("render", str(input_path))
            self.assertEqual(escaping.returncode, 2)
            self.assertIn("relative", escaping.stderr)

            audit["findings"][0]["evidence"][0]["path"] = "screenshots/missing.png"
            self.write_audit(input_path, audit)
            missing = self.run_cli("render", str(input_path))
            self.assertEqual(missing.returncode, 2)
            self.assertIn("missing", missing.stderr)

    def test_validate_detects_score_tampering(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            input_path, audit = self.initialize(Path(temporary_directory) / "runs")
            self.finish_scenarios(audit)
            self.write_audit(input_path, audit)
            rendered = self.run_cli("render", str(input_path), "--fail-on", "never")
            self.assertEqual(rendered.returncode, 0, rendered.stderr)
            report_path = input_path.parent / "report.json"
            report = json.loads(report_path.read_text(encoding="utf-8"))
            report["score"]["overall"] = 1
            report_path.write_text(json.dumps(report), encoding="utf-8")

            validated = self.run_cli("validate", str(report_path))
            self.assertEqual(validated.returncode, 2)
            self.assertIn("stored score", validated.stderr)

    def test_scoring_deduplicates_fingerprints_and_applies_caps(self) -> None:
        findings = []
        for index in range(10):
            finding = self.finding(title=f"Finding {index}")
            finding["ruleId"] = "same-rule"
            finding["fingerprint"] = f"fingerprint-{index}"
            findings.append(REPORT_MODULE.normalize_finding(finding, index))
        findings.append(dict(findings[0]))
        score = REPORT_MODULE.calculate_score(findings)
        self.assertEqual(score["chaosPenalty"], 20.0)
        self.assertEqual(score["overall"], 80)

    def test_fingerprint_survives_measurement_changes(self) -> None:
        first = self.finding()
        second = self.finding()
        second["measurements"]["elementRight"] = 1200
        normalized_first = REPORT_MODULE.normalize_finding(first, 0)
        normalized_second = REPORT_MODULE.normalize_finding(second, 1)
        self.assertEqual(
            normalized_first["fingerprint"], normalized_second["fingerprint"]
        )

    def test_compare_proves_a_finding_stopped_reproducing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary = Path(temporary_directory)
            before_input, before = self.initialize(temporary / "before")
            self.finish_scenarios(before)
            before["findings"] = [self.finding()]
            before["scenarios"][1]["status"] = "completed-with-findings"
            self.write_audit(before_input, before)
            rendered_before = self.run_cli(
                "render", str(before_input), "--fail-on", "never"
            )
            self.assertEqual(rendered_before.returncode, 0, rendered_before.stderr)

            after_input, after = self.initialize(temporary / "after")
            self.finish_scenarios(after)
            self.write_audit(after_input, after)
            rendered_after = self.run_cli(
                "render", str(after_input), "--fail-on", "never"
            )
            self.assertEqual(rendered_after.returncode, 0, rendered_after.stderr)

            compared = self.run_cli(
                "compare",
                str(before_input.parent / "report.json"),
                str(after_input.parent / "report.json"),
                "--fail-on",
                "major",
            )
            self.assertEqual(compared.returncode, 0, compared.stderr)
            verification = json.loads(
                (after_input.parent / "verification.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(verification["counts"]["resolved"], 1)
            self.assertEqual(verification["counts"]["remaining"], 0)
            self.assertEqual(verification["counts"]["new"], 0)
            self.assertEqual(verification["counts"]["unverified"], 0)
            self.assertIn(
                "同一检测器未再复现",
                (after_input.parent / "verification.md").read_text(
                    encoding="utf-8"
                ),
            )
            verification_html = (
                after_input.parent / "verification.html"
            ).read_text(encoding="utf-8")
            self.assertIn("Did the fix really work?", verification_html)
            self.assertIn("修复真的有效吗", verification_html)
            self.assertIn("Content-Security-Policy", verification_html)
            self.assertNotRegex(verification_html, r'(?:src|href)=["\']https://')

    def test_regression_baseline_ignores_known_debt_but_blocks_worsening(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary = Path(temporary_directory)
            before_input, before = self.initialize(temporary / "before")
            self.finish_scenarios(before)
            before_finding = self.finding(severity="major")
            before["findings"] = [before_finding]
            before["scenarios"][1]["status"] = "completed-with-findings"
            self.write_audit(before_input, before)
            self.assertEqual(
                self.run_cli("render", str(before_input), "--fail-on", "never").returncode,
                0,
            )

            same_input, same = self.initialize(temporary / "same")
            self.finish_scenarios(same)
            same["findings"] = [self.finding(severity="major")]
            same["scenarios"][1]["status"] = "completed-with-findings"
            self.write_audit(same_input, same)
            self.assertEqual(
                self.run_cli("render", str(same_input), "--fail-on", "never").returncode,
                0,
            )
            known_debt = self.run_cli(
                "compare",
                str(before_input.parent / "report.json"),
                str(same_input.parent / "report.json"),
                "--fail-on",
                "major",
                "--regressions-only",
            )
            self.assertEqual(known_debt.returncode, 0, known_debt.stderr)

            worse_input, worse = self.initialize(temporary / "worse")
            self.finish_scenarios(worse)
            worse["findings"] = [self.finding(severity="critical")]
            worse["scenarios"][1]["status"] = "completed-with-findings"
            self.write_audit(worse_input, worse)
            self.assertEqual(
                self.run_cli("render", str(worse_input), "--fail-on", "never").returncode,
                0,
            )
            regression = self.run_cli(
                "compare",
                str(before_input.parent / "report.json"),
                str(worse_input.parent / "report.json"),
                "--fail-on",
                "major",
                "--regressions-only",
            )
            self.assertEqual(regression.returncode, 1, regression.stderr)
            verification = json.loads(
                (worse_input.parent / "verification.json").read_text(encoding="utf-8")
            )
            self.assertEqual(verification["counts"]["worsened"], 1)
            self.assertEqual(verification["counts"]["remaining"], 0)
            self.assertEqual(verification["threshold"]["scope"], "regressions-only")

    def test_regression_baseline_cannot_bypass_release_policy(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary = Path(temporary_directory)
            before_input, before = self.initialize(temporary / "before")
            self.finish_scenarios(before)
            before["findings"] = [self.finding(severity="minor")]
            before["scenarios"][1]["status"] = "completed-with-findings"
            self.write_audit(before_input, before)
            self.assertEqual(self.run_cli("render", str(before_input), "--fail-on", "never").returncode, 0)

            after_input, after = self.initialize(temporary / "after")
            self.finish_scenarios(after)
            after["findings"] = [self.finding(severity="minor")]
            after["scenarios"][1]["status"] = "completed-with-findings"
            after["config"]["qualityGate"] = {"minimumScore": 100}
            self.write_audit(after_input, after)
            self.assertEqual(self.run_cli("render", str(after_input), "--fail-on", "major").returncode, 1)

            compared = self.run_cli(
                "compare",
                str(before_input.parent / "report.json"),
                str(after_input.parent / "report.json"),
                "--fail-on",
                "major",
                "--regressions-only",
            )
            self.assertEqual(compared.returncode, 1, compared.stderr)
            verification = json.loads((after_input.parent / "verification.json").read_text(encoding="utf-8"))
            self.assertEqual(verification["counts"]["new"], 0)
            self.assertEqual(verification["threshold"]["violations"][0]["code"], "minimum-score")
            self.assertIn("发布门禁为什么失败", (after_input.parent / "verification.html").read_text(encoding="utf-8"))

    def test_stale_regression_baseline_fails_with_an_explainable_age_policy(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary = Path(temporary_directory)
            before_input, before = self.initialize(temporary / "before")
            self.finish_scenarios(before)
            before["run"]["startedAt"] = "2026-01-01T00:00:00Z"
            before["run"]["finishedAt"] = "2026-01-01T00:01:00Z"
            before["config"]["policyFingerprint"] = "sha256:" + "a" * 64
            self.write_audit(before_input, before)
            self.assertEqual(self.run_cli("render", str(before_input), "--fail-on", "never").returncode, 0)

            after_input, after = self.initialize(temporary / "after")
            self.finish_scenarios(after)
            after["run"]["startedAt"] = "2026-08-01T00:00:00Z"
            after["run"]["finishedAt"] = "2026-08-01T00:01:00Z"
            after["config"]["baselinePolicy"] = {"maxAgeDays": 30}
            after["config"]["policyFingerprint"] = "sha256:" + "b" * 64
            self.write_audit(after_input, after)
            self.assertEqual(self.run_cli("render", str(after_input), "--fail-on", "never").returncode, 0)

            compared = self.run_cli(
                "compare",
                str(before_input.parent / "report.json"),
                str(after_input.parent / "report.json"),
                "--fail-on",
                "never",
                "--regressions-only",
                "--max-baseline-age-days",
                "30",
                "--require-same-policy",
            )
            self.assertEqual(compared.returncode, 1, compared.stderr)
            verification = json.loads((after_input.parent / "verification.json").read_text(encoding="utf-8"))
            self.assertEqual(
                verification["threshold"]["violations"],
                [
                    {"actual": 212.0, "code": "baseline-age", "expected": 30},
                    {"actual": 1, "code": "policy-drift", "expected": 0},
                ],
            )
            self.assertEqual(verification["threshold"]["maximumBaselineAgeDays"], 30)
            self.assertEqual(verification["before"]["mode"], "quick")
            self.assertEqual(verification["after"]["policyFingerprint"], "sha256:" + "b" * 64)
            self.assertIn("回归基线已有 212 天", (after_input.parent / "verification.html").read_text(encoding="utf-8"))
            self.assertIn("使用了不同的检测策略", (after_input.parent / "verification.html").read_text(encoding="utf-8"))
            self.assertIn("baseline age:      212 day(s) / 30 allowed", compared.stdout)
            self.assertIn("detector policy:   DRIFTED", compared.stdout)

    def test_trend_dashboard_tracks_score_change_across_runs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary = Path(temporary_directory)
            before_input, before = self.initialize(temporary / "runs-before")
            self.finish_scenarios(before)
            before["run"]["id"] = "run-before"
            before["run"]["startedAt"] = "2026-08-01T00:00:00Z"
            before["findings"] = [self.finding(severity="major")]
            before["scenarios"][1]["status"] = "completed-with-findings"
            before["config"]["qualityGate"] = {"minimumScore": 100}
            self.write_audit(before_input, before)
            self.assertEqual(
                self.run_cli("render", str(before_input), "--fail-on", "never").returncode,
                1,
            )

            after_input, after = self.initialize(temporary / "runs-after")
            self.finish_scenarios(after)
            after["run"]["id"] = "run-after"
            after["run"]["startedAt"] = "2026-08-02T00:00:00Z"
            self.write_audit(after_input, after)
            self.assertEqual(
                self.run_cli("render", str(after_input), "--fail-on", "never").returncode,
                0,
            )

            output = temporary / "trend-output"
            result = self.run_cli(
                "trend", str(temporary), "--output", str(output)
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            trend = json.loads((output / "trend.json").read_text(encoding="utf-8"))
            self.assertEqual(trend["summary"]["runs"], 2)
            self.assertEqual(trend["summary"]["targets"], 1)
            self.assertEqual(trend["series"][0]["firstScore"], 92)
            self.assertEqual(trend["series"][0]["latestScore"], 100)
            self.assertEqual(trend["series"][0]["scoreDelta"], 8)
            self.assertTrue(trend["series"][0]["points"][0]["gateFailed"])
            self.assertFalse(trend["series"][0]["points"][-1]["gateFailed"])
            self.assertTrue(
                trend["series"][0]["points"][-1]["reportPath"].endswith("report.html")
            )
            html = (output / "trend.html").read_text(encoding="utf-8")
            self.assertIn("Are releases getting safer?", html)
            self.assertIn("每一次发布都更可靠吗？", html)
            self.assertIn("Content-Security-Policy", html)
            self.assertIn('data-trend-filter="down"', html)
            self.assertIn('class="trend-search"', html)
            self.assertIn('class="trend-count"', html)
            self.assertIn("显示 ${shown}/1 项", html)

    def test_reference_report_is_reproducible(self) -> None:
        reference = REPOSITORY_ROOT / "examples" / "reference-run"
        with tempfile.TemporaryDirectory() as temporary_directory:
            temporary = Path(temporary_directory)
            input_path = temporary / "audit-input.json"
            shutil.copyfile(reference / "audit-input.json", input_path)
            rendered = self.run_cli("render", str(input_path), "--fail-on", "major")
            self.assertEqual(rendered.returncode, 1, rendered.stderr)
            self.assertEqual(
                json.loads((temporary / "report.json").read_text(encoding="utf-8")),
                json.loads((reference / "report.json").read_text(encoding="utf-8")),
            )
            self.assertEqual(
                (temporary / "report.md").read_text(encoding="utf-8"),
                (reference / "report.md").read_text(encoding="utf-8"),
            )
            self.assertEqual(
                (temporary / "report.html").read_text(encoding="utf-8"),
                (reference / "report.html").read_text(encoding="utf-8"),
            )


if __name__ == "__main__":
    unittest.main()
