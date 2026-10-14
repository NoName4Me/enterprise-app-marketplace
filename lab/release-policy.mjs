export const REPOSITORY = "NoName4Me/enterprise-app-marketplace";
export const IMAGE = "ghcr.io/noname4me/enterprise-app-marketplace-lab";
export const CI_PATH = ".github/workflows/t01-compatibility.yml";
export const RELEASE_PATH = ".github/workflows/lab-publish.yml";
const SHA = /^[a-f0-9]{40}$/;
const DIGEST = /^sha256:[a-f0-9]{64}$/;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

export function verifyLocalTarget({ platform, architecture, context, endpoint, dockerHostOverride }) {
  requireValue(platform === "darwin" && architecture === "arm64", "Deploy only from the local Apple Silicon Mac.");
  requireValue(context === "orbstack" && endpoint?.startsWith("unix://") && !dockerHostOverride, "Expected local OrbStack socket; remote Docker or DOCKER_HOST override is forbidden.");
}

export function verifyCI(run, jobs, expectedSHA) {
  requireValue(SHA.test(expectedSHA), "Invalid source SHA.");
  requireValue(run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY, "Foreign CI repository.");
  requireValue(run.path === CI_PATH && run.event === "push" && run.head_branch === "master", "Only trusted master push CI may publish.");
  requireValue(run.status === "completed" && run.conclusion === "success" && run.head_sha === expectedSHA, "Source CI has not passed for this SHA.");
  requireValue(jobs.length === 1 && jobs[0].name === "validate" && jobs[0].status === "completed" && jobs[0].conclusion === "success" && jobs[0].run_id === run.id, "Required validate job did not pass.");
  requireValue(Number.isSafeInteger(run.id) && run.id > 0, "Invalid CI run ID.");
  return expectedSHA;
}

export function verifyPublication(run) {
  requireValue(run.repository?.full_name === REPOSITORY && run.head_repository?.full_name === REPOSITORY, "Foreign publication repository.");
  requireValue(run.path === RELEASE_PATH && run.event === "workflow_run" && run.head_branch === "master", "Untrusted publication workflow.");
  requireValue(run.status === "completed" && run.conclusion === "success" && SHA.test(run.head_sha), "Publication has not succeeded.");
  return run;
}

export function verifyManifest(manifest, publication) {
  verifyPublication(publication);
  requireValue(manifest.schemaVersion === 1 && manifest.repository === REPOSITORY && manifest.sourceSHA === publication.head_sha, "Manifest source mismatch.");
  requireValue(manifest.publishRunID === publication.id && Number.isSafeInteger(manifest.ciRunID) && manifest.ciRunID > 0, "Manifest run mismatch.");
  for (const variant of ["healthy", "unhealthy"]) {
    const image = manifest.images?.[variant];
    requireValue(image?.repository === IMAGE && DIGEST.test(image.digest) && image.platform === "linux/arm64", "Expected allowlisted ARM64 image digest.");
  }
  requireValue(manifest.images.healthy.digest !== manifest.images.unhealthy.digest, "Fault image must have a distinct digest.");
  return manifest;
}
