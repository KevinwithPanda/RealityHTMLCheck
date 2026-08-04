import { createHash } from "node:crypto";
import { copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MAX_PNG_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 20_000_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertPng(buffer, label) {
  if (!Buffer.isBuffer(buffer) || buffer.length < PNG_SIGNATURE.length || !buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    throw new Error(`${label} is not a PNG image`);
  }
  if (buffer.length > MAX_PNG_BYTES) throw new Error(`${label} exceeds the 12 MiB comparison limit`);
}

function pngDimensions(buffer) {
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function pathIdentity(target) {
  const pathname = new URL(target).pathname || "/";
  const slug = pathname.split("/").filter(Boolean).join("-").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "root";
  return { pathname, filename: `${slug}-${sha256(pathname).slice(0, 12)}.png` };
}

export function visualBaselineFilename(target) {
  return pathIdentity(target).filename;
}

export function resolveVisualBaselineDirectory(configDirectory, configuredPath, { create = false } = {}) {
  if (typeof configuredPath !== "string" || !configuredPath.trim()) throw new Error("visual.baselineDirectory must be a non-empty relative path");
  if (isAbsolute(configuredPath)) throw new Error("visual.baselineDirectory must stay inside the project config directory");
  const root = resolve(configDirectory);
  const candidate = resolve(root, configuredPath);
  const inside = relative(root, candidate);
  if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside)) {
    throw new Error("visual.baselineDirectory must be a child of the project config directory");
  }
  let current = root;
  for (const segment of inside.split(/[\\/]+/).filter(Boolean)) {
    current = join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) throw new Error("visual.baselineDirectory must not traverse symbolic links");
  }
  if (create) mkdirSync(candidate, { recursive: true });
  return candidate;
}

export function visualBaselinePath(baselineDirectory, target) {
  return join(resolve(baselineDirectory), visualBaselineFilename(target));
}

function readBaselineIndex(path) {
  if (!existsSync(path)) return { schemaVersion: "1", kind: "visual-baseline-index", entries: [] };
  let value;
  try {
    value = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Existing visual baseline index is invalid: ${error.message}`);
  }
  if (value?.schemaVersion !== "1" || value?.kind !== "visual-baseline-index" || !Array.isArray(value.entries)) {
    throw new Error("Existing visual baseline index has an unsupported structure");
  }
  return value;
}

export function approveVisualBaseline({ report, reportPath, configDirectory, policy, replace = false, now = new Date() }) {
  if (!report?.run?.id || !report?.target?.requestedUrl) throw new Error("visual-approve requires a validated page report");
  if (!report.adapter?.capabilities?.includes("explicit-visual-regression-baseline")) throw new Error("The report was not produced with explicit visual regression policy");
  const source = join(dirname(resolve(reportPath)), "screenshots", "visual-current.png");
  if (!existsSync(source) || lstatSync(source).isSymbolicLink()) throw new Error("The report has no safe visual-current.png; run an audit with visual policy first");
  const sourceBytes = readFileSync(source);
  assertPng(sourceBytes, "visual-current.png");
  const directory = resolveVisualBaselineDirectory(configDirectory, policy.baselineDirectory, { create: true });
  const target = report.target.finalUrl || report.target.requestedUrl;
  const identity = pathIdentity(target);
  const destination = join(directory, identity.filename);
  const sourceDigest = sha256(sourceBytes);
  let replaced = false;
  let unchanged = false;
  if (existsSync(destination)) {
    if (lstatSync(destination).isSymbolicLink()) throw new Error("The visual baseline target must not be a symbolic link");
    const previous = readFileSync(destination);
    assertPng(previous, "Existing visual baseline");
    const previousDigest = sha256(previous);
    if (previousDigest === sourceDigest) unchanged = true;
    else if (!replace) throw new Error("A different approved baseline already exists; review the report, then pass --replace-baseline to replace it explicitly");
    else replaced = true;
  }
  if (!unchanged) writeFileSync(destination, sourceBytes);

  const indexPath = join(directory, "visual-baseline-index.json");
  const index = readBaselineIndex(indexPath);
  const approvedAt = now.toISOString();
  const entry = {
    pathname: identity.pathname,
    filename: identity.filename,
    sha256: `sha256:${sourceDigest}`,
    sourceRunId: report.run.id,
    approvedAt,
  };
  index.entries = [...index.entries.filter((item) => item?.pathname !== identity.pathname), entry]
    .sort((left, right) => left.pathname.localeCompare(right.pathname));
  index.updatedAt = approvedAt;
  writeFileSync(indexPath, `${JSON.stringify(index, null, 2)}\n`, "utf8");
  return { destination, indexPath, entry, replaced, unchanged };
}

export async function evaluateVisualRegression(page, target, runDirectory, policy) {
  const currentPath = join(runDirectory, "screenshots", "visual-current.png");
  const mask = policy.masks.map((selector) => page.locator(selector));
  try {
    await page.screenshot({ path: currentPath, fullPage: true, animations: "disabled", caret: "hide", mask, maskColor: "#ff00ff" });
  } catch (_) {
    return { state: "unusable", reason: "One or more visual mask selectors could not be applied safely", currentPath, measurements: { maskedSelectors: policy.masks.length } };
  }
  const currentBytes = readFileSync(currentPath);
  try {
    assertPng(currentBytes, "Current visual snapshot");
  } catch (error) {
    return { state: "unusable", reason: String(error.message || error).slice(0, 200), currentPath, measurements: { maskedSelectors: policy.masks.length } };
  }
  const currentDimensions = pngDimensions(currentBytes);
  const baselinePath = visualBaselinePath(policy.baselineDirectoryPath, target);
  if (!existsSync(baselinePath)) {
    return { state: "missing", currentPath, baselinePath, measurements: { currentWidth: currentDimensions.width, currentHeight: currentDimensions.height, maskedSelectors: policy.masks.length } };
  }
  if (lstatSync(baselinePath).isSymbolicLink()) {
    return { state: "unusable", reason: "The approved visual baseline is a symbolic link", currentPath, baselinePath, measurements: { maskedSelectors: policy.masks.length } };
  }
  const approvedCopyPath = join(runDirectory, "screenshots", "visual-approved.png");
  try {
    const current = currentBytes;
    const baseline = readFileSync(baselinePath);
    assertPng(current, "Current visual snapshot");
    assertPng(baseline, "Approved visual baseline");
    copyFileSync(baselinePath, approvedCopyPath);
    const comparison = await page.evaluate(async ({ currentPng, baselinePng, pixelThreshold, maxDiffRatio, maxPixels }) => {
      const load = (source) => new Promise((resolveImage, rejectImage) => {
        const image = new Image();
        image.onload = () => resolveImage(image);
        image.onerror = () => rejectImage(new Error("PNG decode failed"));
        image.src = source;
      });
      const [currentImage, baselineImage] = await Promise.all([load(currentPng), load(baselinePng)]);
      const width = Math.max(currentImage.naturalWidth, baselineImage.naturalWidth);
      const height = Math.max(currentImage.naturalHeight, baselineImage.naturalHeight);
      const totalPixels = width * height;
      if (!width || !height || totalPixels > maxPixels) throw new Error("Snapshot dimensions exceed the comparison limit");
      const makeCanvas = () => {
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        return canvas;
      };
      const currentCanvas = makeCanvas();
      const baselineCanvas = makeCanvas();
      currentCanvas.getContext("2d", { willReadFrequently: true }).drawImage(currentImage, 0, 0);
      baselineCanvas.getContext("2d", { willReadFrequently: true }).drawImage(baselineImage, 0, 0);
      const currentData = currentCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height);
      const baselineData = baselineCanvas.getContext("2d", { willReadFrequently: true }).getImageData(0, 0, width, height);
      const dimensionsMatch = currentImage.naturalWidth === baselineImage.naturalWidth && currentImage.naturalHeight === baselineImage.naturalHeight;
      let changedPixels = 0;
      const diffCanvas = makeCanvas();
      const diffContext = diffCanvas.getContext("2d");
      const diff = diffContext.createImageData(width, height);
      for (let index = 0; index < currentData.data.length; index += 4) {
        const changed = !dimensionsMatch || Math.max(
          Math.abs(currentData.data[index] - baselineData.data[index]),
          Math.abs(currentData.data[index + 1] - baselineData.data[index + 1]),
          Math.abs(currentData.data[index + 2] - baselineData.data[index + 2]),
          Math.abs(currentData.data[index + 3] - baselineData.data[index + 3]),
        ) > pixelThreshold;
        if (changed) changedPixels += 1;
        const grey = Math.round((currentData.data[index] + currentData.data[index + 1] + currentData.data[index + 2]) / 3);
        diff.data[index] = changed ? 255 : grey;
        diff.data[index + 1] = changed ? 0 : grey;
        diff.data[index + 2] = changed ? 160 : grey;
        diff.data[index + 3] = changed ? 255 : 90;
      }
      diffContext.putImageData(diff, 0, 0);
      const diffRatio = totalPixels ? changedPixels / totalPixels : 1;
      return {
        currentWidth: currentImage.naturalWidth,
        currentHeight: currentImage.naturalHeight,
        baselineWidth: baselineImage.naturalWidth,
        baselineHeight: baselineImage.naturalHeight,
        dimensionsMatch,
        changedPixels,
        totalPixels,
        diffRatio,
        diffPng: diffRatio > maxDiffRatio ? diffCanvas.toDataURL("image/png").split(",")[1] : null,
      };
    }, {
      currentPng: `data:image/png;base64,${current.toString("base64")}`,
      baselinePng: `data:image/png;base64,${baseline.toString("base64")}`,
      pixelThreshold: policy.pixelThreshold,
      maxDiffRatio: policy.maxDiffRatio,
      maxPixels: MAX_PIXELS,
    });
    const measurements = {
      ...comparison,
      maxDiffRatio: policy.maxDiffRatio,
      pixelThreshold: policy.pixelThreshold,
      maskedSelectors: policy.masks.length,
    };
    delete measurements.diffPng;
    if (comparison.diffRatio <= policy.maxDiffRatio) return { state: "passed", currentPath, baselinePath, approvedCopyPath, measurements };
    const diffPath = join(runDirectory, "screenshots", "visual-diff.png");
    writeFileSync(diffPath, Buffer.from(comparison.diffPng, "base64"));
    return { state: "failed", currentPath, baselinePath, approvedCopyPath, diffPath, measurements };
  } catch (error) {
    return {
      state: "unusable",
      reason: String(error.message || error).slice(0, 200),
      currentPath,
      baselinePath,
      approvedCopyPath: existsSync(approvedCopyPath) ? approvedCopyPath : null,
      measurements: { maskedSelectors: policy.masks.length },
    };
  }
}
