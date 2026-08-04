import { createHash } from "node:crypto";

import { TOOL_VERSION } from "./version.mjs";

function canonicalize(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonicalize);
    return items.sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function detectorPolicyFingerprint({ mode, checks = [], journeys = [], budgets = null, network = null, links = null, metadata = null, security = null, toolVersion = TOOL_VERSION }) {
  const policy = canonicalize({ toolVersion, mode, checks, journeys, budgets, network, links, metadata, security });
  return `sha256:${createHash("sha256").update(JSON.stringify(policy)).digest("hex")}`;
}
