import {describe,expect,it} from "vitest";
import {trustedRun,trustedBuildImage} from "./hosted-proof";
const repo="Example/web";
const appId="22222222-2222-4222-8222-222222222222";
const sha="a".repeat(40);
const runId="123456";
const image="ghcr.io/example/web@sha256:"+"b".repeat(64);
const deployment={environment:"marketplace-build-artifact",payload:{
  app_id:appId,source_sha:sha,workflow_run_id:Number(runId),image,
}};
describe("Hosted source artifact provenance gate",()=>{
  it("requires the exact trusted GitHub Actions workflow",()=>{
    expect(trustedRun({event:"workflow_dispatch",status:"completed",conclusion:"success",
      path:"Example/web/.github/workflows/marketplace-build.yml@refs/heads/main"})).toBe(true);
    expect(trustedRun({event:"push",status:"completed",conclusion:"success",
      path:"Example/web/.github/workflows/marketplace-build.yml"})).toBe(false);
    expect(trustedRun({event:"workflow_dispatch",status:"completed",conclusion:"failure",
      path:"Example/web/.github/workflows/marketplace-build.yml"})).toBe(false);
  });
  it("binds the digest to repo, app, commit and a unique run",()=>{
    expect(trustedBuildImage([deployment],{appId,runId,sha,repository:repo})).toBe(image);
    expect(trustedBuildImage([deployment],{appId,runId:"123457",sha,repository:repo})).toBe(null);
    expect(trustedBuildImage([deployment],{appId,runId,sha,repository:"Other/web"})).toBe(null);
    expect(trustedBuildImage([{...deployment,environment:"production"}],{appId,runId,sha,repository:repo})).toBe(null);
    expect(trustedBuildImage([deployment,deployment],{appId,runId,sha,repository:repo})).toBe(null);
    expect(trustedBuildImage([{...deployment,payload:{...deployment.payload,image:"ghcr.io/example/web:latest"}}],
      {appId,runId,sha,repository:repo})).toBe(null);
  });
});
