import { appendFileSync } from "node:fs";
import { verifyCI, REPOSITORY, CI_PATH } from "./release-policy.mjs";
const runID = process.env.CI_RUN_ID;
if (!/^\d+$/.test(runID ?? "")) throw new Error("Expected CI run ID.");
async function api(path) {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/${path}`, {
    headers: { Authorization: `Bearer ${process.env.GH_TOKEN}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`GitHub API failed (${response.status}).`);
  return response.json();
}
const [run, jobs, master, workflow] = await Promise.all([api(`actions/runs/${runID}`), api(`actions/runs/${runID}/jobs?per_page=100`), api("git/ref/heads/master"), api(`actions/workflows/${CI_PATH.split("/").at(-1)}`)]);
if (run.workflow_id !== workflow.id || run.id !== Number(runID)) throw new Error("CI workflow identity mismatch.");
const sha = verifyCI(run, jobs.jobs, master.object.sha);
appendFileSync(process.env.GITHUB_OUTPUT, `sha=${sha}\nci_run_id=${runID}\n`);
console.log(`Trusted master SHA ${sha}; CI ${runID} passed.`);
