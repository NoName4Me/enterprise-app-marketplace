import { createServer } from "node:net";
import { execFileSync } from "node:child_process";
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("Mac ARM64 lab required");
const platform = execFileSync("docker", ["info", "--format", "{{.OSType}}/{{.Architecture}}"], { encoding: "utf8" }).trim();
if (!["linux/aarch64", "linux/arm64"].includes(platform)) throw new Error("Expected ARM64 Linux Docker engine");
for (const port of [55442, 3380, 3381]) {
  await new Promise((resolve, reject) => {
    const server = createServer(); server.once("error", reject);
    server.listen(port, "127.0.0.1", () => server.close(resolve));
  });
}
console.log("Mac ARM64 Docker and lab ports are available. Existing containers and volumes were not changed.");
