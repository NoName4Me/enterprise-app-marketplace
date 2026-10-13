import { readFileSync } from "node:fs";
import { bootstrapInitialAdministrator } from "../src/lib/auth";
const input = JSON.parse(readFileSync(0, "utf8"));
bootstrapInitialAdministrator(input).then(() => process.exit(0)).catch(() => {
  console.error("Administrator bootstrap refused or failed; no credentials are logged.");
  process.exit(1);
});
