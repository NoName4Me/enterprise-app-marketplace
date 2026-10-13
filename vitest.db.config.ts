import {defineConfig} from "vitest/config";
import {resolve} from "node:path";
export default defineConfig({
 resolve:{alias:{"@":resolve(process.cwd(),"src")}},
 test:{environment:"node",include:["tests/**/*.integration.test.ts"],testTimeout:15000,fileParallelism:false,maxWorkers:1}
});
