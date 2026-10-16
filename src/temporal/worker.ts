import "dotenv/config";
import { NativeConnection, Worker } from "@temporalio/worker";
import * as activities from "./activities";
import * as hostedActivities from "./hosted-activities";
import * as hostedKubernetes from "./hosted-kubernetes";
import { DELIVERY_QUEUE } from "./contracts";

async function main() {
  const connection = await NativeConnection.connect({ address: process.env.TEMPORAL_ADDRESS || "127.0.0.1:7233" });
  const worker = await Worker.create({
    connection, namespace: process.env.TEMPORAL_NAMESPACE || "default",
    taskQueue: DELIVERY_QUEUE,
    workflowsPath: require.resolve("./workflows"),
    activities: {...activities,...hostedActivities,...hostedKubernetes},
    maxConcurrentActivityTaskExecutions: 2,
  });
  console.log("Temporal delivery worker started:", DELIVERY_QUEUE);
  await worker.run();
}
main().catch(error => { console.error("Temporal worker stopped:", error); process.exitCode = 1; });
