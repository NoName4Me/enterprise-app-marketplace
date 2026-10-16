// Verifies Webpack can compile the deterministic Temporal Workflow sandbox, without running a server.
import { bundleWorkflowCode } from "@temporalio/worker";

async function main() {
  const bundle = await bundleWorkflowCode({ workflowsPath: require.resolve("./workflows") });
  if (!bundle.code.length) throw new Error("Temporal workflow bundle was empty");
  console.log("Temporal workflow bundle OK");
}
main().catch(e => { console.error(e); process.exitCode = 1; });
