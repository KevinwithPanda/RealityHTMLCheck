import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { validateArtifactFiles } from "./artifact-validator.mjs";
import { loadEvidenceTrustPolicy } from "./evidence-trust.mjs";
import { TOOL_VERSION } from "./version.mjs";
import { updateLatestRunArtifacts } from "./latest-run.mjs";

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll(":", ":\u200B").replaceAll("/", "/\u200B").replace(/([A-Za-z0-9]{12})(?=[A-Za-z0-9])/g, "$1\u200B");
}

function sha256(value) {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function artifactResult(results, kind) {
  return results.find((item) => item.kind === kind);
}

function safeValidation(paths, options = {}) {
  try {
    return validateArtifactFiles(paths, options);
  } catch (error) {
    return [{ kind: "validation-error", valid: false, errors: [error.message] }];
  }
}

function signerStatus(key, now) {
  if (!key) return "unknown";
  if (key.status === "revoked") return "revoked";
  if (key.notBefore && new Date(key.notBefore) > now) return "not-yet-valid";
  if (key.notAfter && now >= new Date(key.notAfter)) return "expired";
  return "trusted";
}

export function buildEvidenceTrustReport(manifestPath, trustPolicyPath, { generatedAt = new Date(), now = generatedAt } = {}) {
  const manifestAbsolute = resolve(manifestPath);
  if (!existsSync(manifestAbsolute) || !statSync(manifestAbsolute).isFile()) throw new Error(`Evidence manifest does not exist: ${manifestAbsolute}`);
  const [policyValidation] = validateArtifactFiles([trustPolicyPath]);
  if (!policyValidation?.valid) throw new Error(`Evidence trust policy failed schema validation: ${policyValidation?.errors.join("; ")}`);
  // A trust-decision artifact must still be produced during an emergency in
  // which every key has been revoked. Validation remains fail-closed; the
  // reporting path is deliberately fail-explained.
  const trust = loadEvidenceTrustPolicy(trustPolicyPath, { now, allowNoActiveKeys: true });
  const policyContents = readFileSync(trust.path);
  const manifestContents = readFileSync(manifestAbsolute);
  const manifest = JSON.parse(manifestContents.toString("utf8"));
  if (manifest.kind !== "evidence-manifest") throw new Error("Trust report input is not an evidence manifest");
  const integrityResults = safeValidation([manifestAbsolute]);
  const signatureResults = safeValidation([manifestAbsolute], { requireAttestation: true });
  const authorizedResults = safeValidation([manifestAbsolute], { requireAttestation: true, trustedKeyIds: trust.trustedKeyIds });
  const attestationPath = join(dirname(manifestAbsolute), "evidence-attestation.json");
  const attestationExists = existsSync(attestationPath);
  let attestation = null;
  if (attestationExists) {
    try {
      attestation = JSON.parse(readFileSync(attestationPath, "utf8"));
    } catch {
      // The artifact validator already records the parse error. Keep building a
      // durable rejected decision instead of losing the audit trail.
    }
  }
  const policyKey = attestation ? trust.policy.keys.find((key) => key.keyId === attestation.signer?.keyId) : null;
  const integrity = Boolean(artifactResult(integrityResults, "evidence-manifest")?.valid);
  const signature = Boolean(artifactResult(signatureResults, "evidence-attestation")?.valid);
  const authorization = Boolean(attestation && trust.trustedKeyIds.includes(attestation.signer?.keyId));
  const errors = [...new Set(authorizedResults.flatMap((item) => item.valid ? [] : item.errors))];
  if (!trust.activeKeys.length) errors.push("Evidence trust policy has no active trusted keys at the decision time");
  if (attestation && !authorization && !errors.some((item) => item.includes("trusted key allowlist"))) {
    errors.push(`Attestation signer ${attestation.signer?.keyId || "unknown"} is not in the trusted key allowlist`);
  }
  return {
    schemaVersion: "1",
    toolVersion: TOOL_VERSION,
    kind: "evidence-trust-report",
    generatedAt: generatedAt.toISOString(),
    state: integrity && signature && authorization ? "trusted" : "rejected",
    manifest: {
      path: "evidence-manifest.json",
      artifactKind: manifest.source.artifactKind,
      runId: manifest.source.runId,
      sha256: sha256(manifestContents),
    },
    policy: {
      sha256: sha256(policyContents),
      requireAttestation: trust.policy.requireAttestation,
      activeKeys: trust.activeKeys.length,
    },
    signer: {
      keyId: attestation?.signer?.keyId || null,
      name: policyKey?.name || null,
      status: !attestation ? (attestationExists ? "unknown" : "missing") : signerStatus(policyKey, now),
    },
    checks: { integrity, signature, authorization },
    errors,
  };
}

export function renderEvidenceTrustReportHtml(report) {
  const trusted = report.state === "trusted";
  const checks = [
    ["integrity", "Evidence integrity", "证据完整性"],
    ["signature", "Ed25519 signature", "Ed25519 签名"],
    ["authorization", "Signer authorization", "签名者授权"],
  ].map(([key, en, zh]) => `<div class="check ${report.checks[key] ? "pass" : "fail"}"><b>${report.checks[key] ? "✓" : "×"}</b><span data-en="${en}" data-zh="${zh}">${en}</span><strong data-en="${report.checks[key] ? "PASS" : "FAIL"}" data-zh="${report.checks[key] ? "通过" : "失败"}">${report.checks[key] ? "PASS" : "FAIL"}</strong></div>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline';base-uri 'none';form-action 'none'"><title>RealityCheck evidence trust decision</title><style>:root{color-scheme:light;--ink:#18191d;--muted:#656a73;--line:#ddd8cf;--paper:#fffdfa;--canvas:#f3f0ea;--good:#13795b;--bad:#bd2840;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--canvas)}header{color:#fff;background:#17181c}.bar,main{width:min(900px,calc(100% - 32px));margin:auto}.bar{min-height:68px;display:flex;align-items:center;justify-content:space-between;font-weight:900}.brand span{color:#ff8b70}.languages button{border:1px solid #44464e;border-radius:7px;padding:7px 10px;color:#c7c9d0;background:transparent}.languages button[aria-pressed=true]{color:#17181c;background:#fff}.hero{padding:68px 0 34px}.verdict{display:inline-block;padding:8px 12px;border-radius:999px;color:${trusted ? "var(--good)" : "var(--bad)"};background:${trusted ? "#e4f4ee" : "#ffe5ea"};font-size:12px;font-weight:900}.eyebrow{margin:20px 0 0;color:${trusted ? "var(--good)" : "var(--bad)"};font-size:11px;font-weight:900;letter-spacing:.12em}h1{max-width:760px;margin:10px 0;font-size:clamp(40px,7vw,68px);line-height:.96;letter-spacing:-.05em}.lede{color:var(--muted);line-height:1.65}.checks{display:grid;gap:10px}.check{display:grid;grid-template-columns:32px 1fr auto;align-items:center;gap:12px;padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}.check b{font-size:22px}.check.pass b,.check.pass strong{color:var(--good)}.check.fail b,.check.fail strong{color:var(--bad)}.meta{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin-top:22px}.card{min-width:0;padding:18px;border:1px solid var(--line);border-radius:14px;background:var(--paper)}.card span{color:var(--muted);font-size:11px}.card code{display:block;margin-top:7px;overflow-wrap:anywhere}.errors{padding:20px;border:1px solid #efb5c0;border-radius:14px;background:#fff3f5}footer{padding:32px 0;color:var(--muted);font-size:11px}@media(max-width:580px){.meta{grid-template-columns:1fr}.hero{padding-top:44px}}</style></head><body><header><div class="bar"><div class="brand">Reality<span>Check</span> / TRUST</div><div class="languages"><button data-language="en" aria-pressed="true">EN</button><button data-language="zh" aria-pressed="false">中文</button></div></div></header><main><section class="hero"><div class="verdict" data-en="${trusted ? "TRUSTED EVIDENCE" : "REJECTED EVIDENCE"}" data-zh="${trusted ? "证据可信" : "证据已拒绝"}">${trusted ? "TRUSTED EVIDENCE" : "REJECTED EVIDENCE"}</div><p class="eyebrow" data-en="ARCHIVE TRUST DECISION" data-zh="归档信任决策">ARCHIVE TRUST DECISION</p><h1 data-en="${trusted ? "Integrity, signature, and authorization agree." : "Evidence trust requirements were not met."}" data-zh="${trusted ? "完整性、签名与授权一致。" : "证据未满足信任要求。"}">${trusted ? "Integrity, signature, and authorization agree." : "Evidence trust requirements were not met."}</h1><p class="lede"><span data-en="Run" data-zh="运行">Run</span> · ${html(report.manifest.runId)}</p></section><section class="checks">${checks}</section><section class="meta"><div class="card"><span data-en="Signer / registry status" data-zh="签名者 / 登记状态">Signer / registry status</span><code>${html(report.signer.name || "—")} · ${html(report.signer.status)}</code></div><div class="card"><span data-en="Key ID" data-zh="密钥 ID">Key ID</span><code>${html(report.signer.keyId || "—")}</code></div><div class="card"><span data-en="Evidence kind" data-zh="证据类型">Evidence kind</span><code>${html(report.manifest.artifactKind)}</code></div><div class="card"><span data-en="Manifest digest" data-zh="清单摘要">Manifest digest</span><code>${html(report.manifest.sha256)}</code></div></section>${report.errors.length ? `<section class="errors"><h2 data-en="Why rejected" data-zh="拒绝原因">Why rejected</h2><ul>${report.errors.map((item) => `<li>${html(item)}</li>`).join("")}</ul></section>` : ""}<footer>Generated ${html(report.generatedAt)} · RealityCheck ${TOOL_VERSION}</footer></main><script>(()=>{const setLanguage=language=>{document.documentElement.lang=language==='zh'?'zh-CN':'en';document.querySelectorAll('[data-en][data-zh]').forEach(node=>node.textContent=node.dataset[language]);document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===language)))};document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.language)));setLanguage(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')})();</script></body></html>`;
}

export function writeEvidenceTrustReport(manifestPath, trustPolicyPath, options = {}) {
  const report = buildEvidenceTrustReport(manifestPath, trustPolicyPath, options);
  const root = dirname(resolve(manifestPath));
  const jsonPath = join(root, "evidence-trust-report.json");
  const htmlPath = join(root, "evidence-trust-report.html");
  writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  writeFileSync(htmlPath, renderEvidenceTrustReportHtml(report), "utf8");
  const latestUpdated = updateLatestRunArtifacts({ outputRoot: dirname(root), runId: report.manifest.runId, updatedAt: report.generatedAt, artifacts: { trustReportJson: jsonPath, trustReportHtml: htmlPath } });
  return { report, jsonPath, htmlPath, latestUpdated };
}
