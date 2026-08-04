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

export function detectorPolicyFingerprint({ mode, viewports = [], checks = [], journeys = [], budgets = null, network = null, links = null, metadata = null, visual = null, security = null, privacy = null, toolVersion = TOOL_VERSION }) {
  const visualPolicy = visual ? Object.fromEntries(Object.entries(visual).filter(([key]) => key !== "baselineDirectoryPath")) : null;
  const policy = canonicalize({ toolVersion, mode, viewports, checks, journeys, budgets, network, links, metadata, visual: visualPolicy, security, privacy });
  return `sha256:${createHash("sha256").update(JSON.stringify(policy)).digest("hex")}`;
}
