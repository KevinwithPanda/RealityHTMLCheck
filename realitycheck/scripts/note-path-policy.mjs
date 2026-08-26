// Authoritative archive path policy shared by Node and browser intake.
const SENSITIVE_SEGMENTS = new Set([".git", ".hg", ".svn", ".ssh", ".aws", ".azure", ".gnupg", ".kube", ".realitycheck", "node_modules"]);
const SENSITIVE_BASENAME = /^(?:\.env(?:\..*)?|\.netrc|\.npmrc|\.pypirc|\.htpasswd|id_(?:rsa|dsa|ecdsa|ed25519)|(?:credentials?|secrets?|auth|tokens?|oauth|client[_-]?secret|service[_-]?account)(?:\.(?:json|ya?ml|toml))?|cookies?\.json|storage-state\.json|wallet\.dat)$/i;
const SENSITIVE_EXTENSION = /\.(?:pem|key|p12|pfx|ppk|kdbx|keystore|jks)$/i;

/** Identify paths that must never be copied into a browser-generated sharing archive. */
export function isSensitiveNoteArchivePath(path) {
  const segments = String(path || "").split("/");
  const basename = segments.at(-1) || "";
  return segments.some((segment) => SENSITIVE_SEGMENTS.has(segment.toLowerCase()))
    || SENSITIVE_BASENAME.test(basename)
    || SENSITIVE_EXTENSION.test(basename);
}
