import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

export function createLabServer({ mode = "local", fault = "healthy", revision = "local" } = {}) {
  if (mode !== "local") throw new Error("This service is restricted to the local lab.");
  if (!["healthy", "unhealthy"].includes(fault)) throw new Error("Unknown lab fault mode.");
  if (revision !== "local" && !/^[a-f0-9]{40}$/.test(revision)) throw new Error("Expected a full commit SHA.");
  return createServer((request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.setHeader("Cache-Control", "no-store");
    const path = new URL(request.url, "http://localhost").pathname;
    if (request.method !== "GET" || !["/health", "/version"].includes(path)) {
      response.writeHead(404).end(JSON.stringify({ error: "not_found" })); return;
    }
    if (path === "/version") {
      response.end(JSON.stringify({ service: "marketplace-lab", revision, environment: "local-lab" })); return;
    }
    response.writeHead(fault === "healthy" ? 200 : 503).end(JSON.stringify({ status: fault === "healthy" ? "ok" : "failed", faultInjected: fault === "unhealthy" }));
  });
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const server = createLabServer({ mode: process.env.LAB_MODE, fault: process.env.LAB_FAULT, revision: process.env.SOURCE_REVISION });
  server.listen(8080, "0.0.0.0", () => console.log("Local lab service listening on 8080"));
  process.once("SIGTERM", () => server.close(() => process.exit(0)));
  process.once("SIGINT", () => server.close(() => process.exit(0)));
}
