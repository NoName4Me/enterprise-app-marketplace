import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, statfsSync, openSync, closeSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "node:net";
import { verifyCI, verifyManifest, verifyPublication, verifyLocalTarget, REPOSITORY, IMAGE } from "./release-policy.mjs";
import { verifyService } from "./verify-service.mjs";

process.chdir(resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const [runID, variant] = process.argv.slice(2);
const project = "marketplace-lab-release";
const container = `${project}-release-1`;
const placeholder = `${IMAGE}@sha256:${"0".repeat(64)}`;
mkdirSync(".lab-release-records", { recursive: true, mode: 0o700 });
const lock = ".lab-release-records/deploy.lock";
try { closeSync(openSync(lock, "wx", 0o600)); }
catch { throw new Error("Another deployment is running or a stale lock exists; inspect before retrying."); }
process.once("exit", () => rmSync(lock, { force: true }));
function command(program, args, { env, allowFailure = false, quiet = false } = {}) {
  const result = spawnSync(program, args, { encoding: "utf8", env: { ...process.env, ...env }, timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  if (!quiet) { if (result.stdout) process.stdout.write(result.stdout); if (result.stderr) process.stderr.write(result.stderr); }
  if (!allowFailure && (result.error || result.status !== 0)) throw new Error(`${program} failed (${result.status ?? result.error?.code}).`);
  return result;
}
function api(path) { return JSON.parse(command("gh", ["api", `repos/${REPOSITORY}/${path}`], { quiet: true }).stdout); }
function compose(image, ...args) {
  return command("docker", ["compose", "-p", project, "-f", "lab/release.compose.yaml", ...args], { env: { LAB_RELEASE_IMAGE: image }, allowFailure: true });
}
const context = command("docker", ["context", "show"], { quiet: true }).stdout.trim();
const endpoint = JSON.parse(command("docker", ["context", "inspect", context, "--format", "{{json .Endpoints.docker}}"], { quiet: true }).stdout).Host;
verifyLocalTarget({ platform: process.platform, architecture: process.arch, context, endpoint, dockerHostOverride: process.env.DOCKER_HOST });
if (["status", "stop"].includes(runID) && !variant) {
  const result = compose(placeholder, runID === "status" ? "ps" : "down");
  process.exit(result.status ?? 1);
}
if (!/^\d+$/.test(runID ?? "") || !["healthy", "unhealthy"].includes(variant)) {
  throw new Error("Allowed: node lab/deploy.mjs <publication-run-id> healthy|unhealthy, or status|stop.");
}
const directory = mkdtempSync(join(tmpdir(), "marketplace-release-"));
let receipt;
try {
  const publication = verifyPublication(api(`actions/runs/${runID}`));
  command("gh", ["run", "download", runID, "--repo", REPOSITORY, "--name", "lab-release", "--dir", directory]);
  const manifest = verifyManifest(JSON.parse(readFileSync(join(directory, "lab-release.json"), "utf8")), publication);
  verifyCI(api(`actions/runs/${manifest.ciRunID}`), api(`actions/runs/${manifest.ciRunID}/jobs?per_page=100`).jobs, manifest.sourceSHA);
  const info = JSON.parse(command("docker", ["info", "--format", "{{json .}}"], { quiet: true }).stdout);
  if (info.OSType !== "linux" || !["aarch64", "arm64"].includes(info.Architecture)) throw new Error("Expected local Linux ARM64 Docker.");
  const disk = statfsSync(process.cwd());
  if (disk.bavail * disk.bsize < 512 * 1024 * 1024) throw new Error("Less than 512MiB host space; refuse deployment.");
  const current = command("docker", ["inspect", container], { allowFailure: true, quiet: true });
  let previous;
  if (current.status === 0) {
    const active = JSON.parse(current.stdout)[0];
    if (active.Config.Labels?.["com.docker.compose.project"] !== project || active.Config.Labels?.["com.docker.compose.service"] !== "release") throw new Error("Foreign container; refuse mutation.");
    if (active.State.Health?.Status !== "healthy" || !active.Config.Image.startsWith(IMAGE + "@sha256:") || !/^sha256:[a-f0-9]{64}$/.test(active.Config.Image.split("@")[1])) throw new Error("Current release is not a verified healthy digest; inspect manually.");
    previous = { image: active.Config.Image, revision: active.Config.Labels["org.opencontainers.image.revision"] };
    await verifyResponse(previous.revision, "healthy");
  } else {
    if (variant === "unhealthy") throw new Error("Fault drill requires an existing healthy release.");
    await new Promise((resolvePort, reject) => {
      const server = createServer(); server.once("error", reject); server.listen(3382, "127.0.0.1", () => server.close(resolvePort));
    });
  }
  const image = `${IMAGE}@${manifest.images[variant].digest}`;
  // Pull and validate BEFORE replacing the existing healthy container.
  command("docker", ["pull", "--platform", "linux/arm64", image]);
  const inspect = JSON.parse(command("docker", ["image", "inspect", image], { quiet: true }).stdout)[0];
  if (inspect.Architecture !== "arm64" || inspect.Os !== "linux" || inspect.Config.User !== "node" || inspect.Config.Labels["org.opencontainers.image.revision"] !== manifest.sourceSHA || inspect.Config.Labels["io.marketplace.lab.variant"] !== variant) throw new Error("Pulled image identity/architecture/user mismatch.");
  receipt = { startedAt: new Date().toISOString(), sourceSHA: manifest.sourceSHA, publicationRunID: Number(runID), ciRunID: manifest.ciRunID, candidate: image, variant, previous: previous?.image ?? null, environment: "local-orbstack-lab", port: 3382 };
  try {
    const result = compose(image, "up", "--no-build", "--wait", "--wait-timeout", "20");
    if (result.status !== 0) throw new Error("Candidate did not become healthy.");
    await verifyResponse(manifest.sourceSHA, variant);
    if (variant !== "healthy") throw new Error("Fault release unexpectedly healthy.");
    receipt.result = "deployed";
  } catch (error) {
    receipt.failure = error.message;
    if (previous) {
      const result = compose(previous.image, "up", "--no-build", "--wait", "--wait-timeout", "30");
      if (result.status !== 0) { receipt.result = "rollback_failed"; process.exitCode = 2; }
      else {
        try {
          await verifyResponse(previous.revision, "healthy");
          receipt.result = "rolled_back"; receipt.restoredImage = previous.image; process.exitCode = 1;
        } catch (rollbackError) {
          receipt.result = "rollback_failed"; receipt.rollbackFailure = rollbackError.message; process.exitCode = 2;
        }
      }
    } else {
      const result = compose(image, "down");
      receipt.result = result.status === 0 ? "failed_stopped" : "cleanup_failed"; process.exitCode = result.status === 0 ? 1 : 2;
    }
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
  if (receipt) {
    receipt.finishedAt = new Date().toISOString();
    mkdirSync(".lab-release-records", { recursive: true, mode: 0o700 });
    const path = `.lab-release-records/${Date.now()}-${variant}.json`;
    writeFileSync(path, JSON.stringify(receipt, null, 2) + "\n", { mode: 0o600 });
    console.log(JSON.stringify(receipt, null, 2));
    console.log(`Deployment receipt: ${path}`);
  }
}
async function verifyResponse(revision, faultMode) {
  await verifyService("http://127.0.0.1:3382", revision, faultMode);
}
