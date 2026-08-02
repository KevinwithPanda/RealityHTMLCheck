import { createHash, createPrivateKey, createPublicKey, sign, verify } from "node:crypto";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

import { verifyEvidenceManifest } from "./evidence-manifest.mjs";
import { TOOL_VERSION } from "./version.mjs";
import { updateLatestRunArtifacts } from "./latest-run.mjs";

const JSON_FILENAME = "evidence-attestation.json";
const HTML_FILENAME = "evidence-attestation.html";

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function html(value) {
  return String(value ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function readRegularFile(path, label) {
  const absolute = resolve(path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`${label} does not exist: ${absolute}`);
  return { absolute, contents: readFileSync(absolute) };
}

export function buildEvidenceAttestationWithKey(manifestPath, privateKeyInput, { createdAt = new Date() } = {}) {
  const manifestFile = readRegularFile(manifestPath, "Evidence manifest");
  if (basename(manifestFile.absolute) !== "evidence-manifest.json") throw new Error("Attestation input must be named evidence-manifest.json");
  let manifest;
  try {
    manifest = JSON.parse(manifestFile.contents.toString("utf8"));
  } catch (error) {
    throw new Error(`Evidence manifest is not valid JSON: ${error.message}`);
  }
  if (manifest?.kind !== "evidence-manifest") throw new Error("Attestation input is not a RealityCheck evidence manifest");
  const integrityErrors = verifyEvidenceManifest(manifestFile.absolute, manifest);
  if (integrityErrors.length) throw new Error(`Evidence manifest integrity check failed before signing: ${integrityErrors.join("; ")}`);
  let privateKey;
  try {
    privateKey = privateKeyInput?.type === "private" && privateKeyInput?.asymmetricKeyType ? privateKeyInput : createPrivateKey(privateKeyInput);
  } catch (error) {
    throw new Error(`Private key could not be loaded: ${error.message}`);
  }
  if (privateKey.asymmetricKeyType !== "ed25519") throw new Error("Private key must be Ed25519");
  const publicKey = createPublicKey(privateKey);
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  const signature = sign(null, manifestFile.contents, privateKey);
  if (!verify(null, manifestFile.contents, publicKey, signature)) throw new Error("Generated attestation failed its internal signature check");
  return {
    schemaVersion: "1",
    toolVersion: TOOL_VERSION,
    kind: "evidence-attestation",
    createdAt: createdAt.toISOString(),
    algorithm: "Ed25519",
    manifest: {
      path: "evidence-manifest.json",
      bytes: manifestFile.contents.byteLength,
      sha256: `sha256:${sha256(manifestFile.contents)}`,
      artifactKind: manifest.source.artifactKind,
      runId: manifest.source.runId,
    },
    signer: {
      keyId: `sha256:${sha256(publicDer)}`,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
    },
    signature: signature.toString("base64"),
  };
}

export function buildEvidenceAttestation(manifestPath, privateKeyPath, options = {}) {
  const keyFile = readRegularFile(privateKeyPath, "Private key");
  return buildEvidenceAttestationWithKey(manifestPath, keyFile.contents, options);
}

export function verifyEvidenceAttestation(attestationPath, attestation) {
  const errors = [];
  const manifestPath = join(dirname(resolve(attestationPath)), "evidence-manifest.json");
  if (attestation.manifest?.path !== "evidence-manifest.json") errors.push("/manifest/path must be the sibling evidence-manifest.json");
  if (!existsSync(manifestPath) || !statSync(manifestPath).isFile()) return [...errors, "/manifest/path evidence-manifest.json is missing"];
  const manifestContents = readFileSync(manifestPath);
  if (attestation.manifest.bytes !== manifestContents.byteLength) errors.push("/manifest/bytes does not match the signed manifest");
  if (attestation.manifest.sha256 !== `sha256:${sha256(manifestContents)}`) errors.push("/manifest/sha256 does not match the signed manifest");
  let publicKey;
  try {
    publicKey = createPublicKey(attestation.signer.publicKey);
    if (publicKey.asymmetricKeyType !== "ed25519") errors.push("/signer/publicKey is not an Ed25519 public key");
  } catch (error) {
    errors.push(`/signer/publicKey could not be loaded: ${error.message}`);
    return errors;
  }
  const publicDer = publicKey.export({ type: "spki", format: "der" });
  if (attestation.signer.keyId !== `sha256:${sha256(publicDer)}`) errors.push("/signer/keyId does not match the embedded public key");
  let signature;
  try {
    signature = Buffer.from(attestation.signature, "base64");
  } catch (error) {
    errors.push(`/signature is not valid base64: ${error.message}`);
    return errors;
  }
  if (!verify(null, manifestContents, publicKey, signature)) errors.push("/signature failed Ed25519 verification");
  return errors;
}

export function renderEvidenceAttestationHtml(attestation) {
  const shortKey = attestation.signer.keyId.slice(0, 23);
  const shortManifest = attestation.manifest.sha256.slice(0, 23);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none';style-src 'unsafe-inline';script-src 'unsafe-inline';base-uri 'none';form-action 'none'"><title>RealityCheck evidence attestation</title><style>:root{color-scheme:light;--ink:#18191d;--muted:#666b73;--line:#ddd8cf;--paper:#fffdfa;--canvas:#f2efe9;--good:#13795b;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;color:var(--ink);background:var(--canvas)}header{color:#fff;background:#17181c}.bar,main{width:min(920px,calc(100% - 32px));margin:auto}.bar{min-height:68px;display:flex;align-items:center;justify-content:space-between;gap:20px;font-weight:900}.brand span{color:#ff8b70}.languages{display:flex;gap:4px}.languages button{border:1px solid #44464e;border-radius:7px;padding:7px 10px;color:#c7c9d0;background:transparent;cursor:pointer}.languages button[aria-pressed=true]{color:#17181c;background:#fff}.hero{padding:70px 0 32px}.eyebrow{color:var(--good);font-size:12px;font-weight:900;letter-spacing:.12em}h1{max-width:760px;margin:12px 0;font-size:clamp(40px,7vw,70px);line-height:.96;letter-spacing:-.05em}.lede{max-width:690px;color:var(--muted);line-height:1.65}.proof{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.card{min-width:0;padding:22px;border:1px solid var(--line);border-radius:16px;background:var(--paper)}.card.wide{grid-column:1/-1}.card span{display:block;color:var(--muted);font-size:11px}.card b,.card code{display:block;margin-top:8px;overflow-wrap:anywhere;font:800 13px ui-monospace,SFMono-Regular,Consolas,monospace}.verified{display:inline-flex;align-items:center;gap:7px;padding:7px 10px;border-radius:999px;color:var(--good);background:#e4f4ee;font-size:12px;font-weight:900}footer{padding:34px 0;color:var(--muted);font-size:11px}@media(max-width:620px){.proof{grid-template-columns:1fr}.card.wide{grid-column:auto}.hero{padding-top:45px}}</style></head><body><header><div class="bar"><div class="brand">Reality<span>Check</span> / ATTESTATION</div><div class="languages"><button data-language="en" aria-pressed="true">EN</button><button data-language="zh" aria-pressed="false">中文</button></div></div></header><main><section class="hero"><div class="verified" data-en="✓ Ed25519 signature created" data-zh="✓ 已创建 Ed25519 签名">✓ Ed25519 signature created</div><p class="eyebrow" data-en="PUBLISHER KEY PROOF" data-zh="发布密钥凭证">PUBLISHER KEY PROOF</p><h1 data-en="Evidence signed for accountable delivery." data-zh="证据已签名，交付可追责。">Evidence signed for accountable delivery.</h1><p class="lede" data-en="The signature binds the exact evidence manifest to this public key. Run RealityCheck validate to recompute the manifest hash and verify the signature before trusting the bundle." data-zh="该签名把精确的证据清单绑定到此公钥。信任证据包之前，请运行 RealityCheck validate 重新计算清单哈希并验证签名。">The signature binds the exact evidence manifest to this public key. Run RealityCheck validate to recompute the manifest hash and verify the signature before trusting the bundle.</p></section><section class="proof"><div class="card"><span data-en="Run" data-zh="运行">Run</span><b>${html(attestation.manifest.runId)}</b></div><div class="card"><span data-en="Evidence kind" data-zh="证据类型">Evidence kind</span><b>${html(attestation.manifest.artifactKind)}</b></div><div class="card"><span data-en="Signer key ID" data-zh="签名者密钥 ID">Signer key ID</span><code title="${html(attestation.signer.keyId)}">${html(shortKey)}…</code></div><div class="card"><span data-en="Manifest digest" data-zh="清单摘要">Manifest digest</span><code title="${html(attestation.manifest.sha256)}">${html(shortManifest)}…</code></div><div class="card wide"><span data-en="Independent verification" data-zh="独立验证">Independent verification</span><code>realitycheck validate evidence-attestation.json</code></div></section><footer>Created ${html(attestation.createdAt)} · RealityCheck ${TOOL_VERSION}</footer></main><script>(()=>{const setLanguage=language=>{document.documentElement.lang=language==='zh'?'zh-CN':'en';document.querySelectorAll('[data-en][data-zh]').forEach(node=>node.textContent=node.dataset[language]);document.querySelectorAll('[data-language]').forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.language===language)))};document.querySelectorAll('[data-language]').forEach(button=>button.addEventListener('click',()=>setLanguage(button.dataset.language)));setLanguage(navigator.language.toLowerCase().startsWith('zh')?'zh':'en')})();</script></body></html>`;
}

function writeAttestationFiles(manifestPath, attestation, { updateLatest = true } = {}) {
  const root = dirname(resolve(manifestPath));
  const jsonPath = join(root, JSON_FILENAME);
  const htmlPath = join(root, HTML_FILENAME);
  writeFileSync(jsonPath, `${JSON.stringify(attestation, null, 2)}\n`, { encoding: "utf8", mode: 0o644 });
  writeFileSync(htmlPath, renderEvidenceAttestationHtml(attestation), { encoding: "utf8", mode: 0o644 });
  let latestUpdated = false;
  if (updateLatest) {
    try {
      latestUpdated = updateLatestRunArtifacts({ outputRoot: dirname(root), runId: attestation.manifest.runId, updatedAt: attestation.createdAt, artifacts: { attestationJson: jsonPath, attestationHtml: htmlPath } });
    } catch (error) {
      throw new Error(`Attestation was written but latest-run update failed: ${error.message}`);
    }
  }
  return { attestation, jsonPath, htmlPath, latestUpdated };
}

export function writeEvidenceAttestation(manifestPath, privateKeyPath, options = {}) {
  const { updateLatest = true, ...buildOptions } = options;
  return writeAttestationFiles(manifestPath, buildEvidenceAttestation(manifestPath, privateKeyPath, buildOptions), { updateLatest });
}

export function writeEvidenceAttestationWithKey(manifestPath, privateKey, options = {}) {
  const { updateLatest = true, ...buildOptions } = options;
  return writeAttestationFiles(manifestPath, buildEvidenceAttestationWithKey(manifestPath, privateKey, buildOptions), { updateLatest });
}
