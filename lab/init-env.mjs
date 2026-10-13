import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
const password = randomBytes(24).toString("hex");
const secret = randomBytes(32).toString("hex");
writeFileSync(new URL(".env", import.meta.url), `LAB_DATABASE_PASSWORD=${password}\nDATABASE_URL=postgresql://market:${password}@localhost:55442/market_test\nBETTER_AUTH_URL=http://localhost:3381\nBETTER_AUTH_SECRET=${secret}\n`, { flag: "wx", mode: 0o600 });
console.log("Created ignored lab/.env with mode 0600; existing configuration is never overwritten.");
