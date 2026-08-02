import { existsSync, readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

export function loadEvidenceTrustPolicy(path, { now = new Date(), allowNoActiveKeys = false } = {}) {
  const absolute = resolve(path);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) throw new Error(`Evidence trust policy does not exist: ${absolute}`);
  let policy;
  try {
    policy = JSON.parse(readFileSync(absolute, "utf8"));
  } catch (error) {
    throw new Error(`Evidence trust policy is not valid JSON: ${error.message}`);
  }
  if (policy?.kind !== "evidence-trust-policy") throw new Error("Trust policy kind must be evidence-trust-policy");
  const seen = new Set();
  for (const key of policy.keys || []) {
    if (seen.has(key.keyId)) throw new Error(`Evidence trust policy repeats key ID: ${key.keyId}`);
    seen.add(key.keyId);
    if (key.notBefore && key.notAfter && new Date(key.notBefore) >= new Date(key.notAfter)) throw new Error(`Evidence trust key ${key.keyId} has a non-increasing validity window`);
  }
  const activeKeys = (policy.keys || []).filter((key) =>
    key.status === "trusted"
    && (!key.notBefore || new Date(key.notBefore) <= now)
    && (!key.notAfter || now < new Date(key.notAfter))
  );
  if (!activeKeys.length && !allowNoActiveKeys) throw new Error("Evidence trust policy has no active trusted keys at the validation time");
  return { path: absolute, policy, activeKeys, trustedKeyIds: activeKeys.map((key) => key.keyId) };
}
