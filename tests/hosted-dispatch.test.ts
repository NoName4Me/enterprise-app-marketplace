import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("../src/db/client",()=>({db:{}}));
import {dispatchHostedBuild} from "../src/temporal/hosted-activities";
import type {HostedReleaseInput} from "../src/temporal/hosted-contracts";

const input:HostedReleaseInput={
  releaseId:"11111111-1111-4111-8111-111111111111",
  appId:"22222222-2222-4222-8222-222222222222",
  environmentId:"33333333-3333-4333-8333-333333333333",
  environment:"TEST",nodePort:31000,repository:"example/test-app",
};
describe("hosted build dispatch outcome",()=>{
  beforeEach(()=>vi.stubEnv("HOSTED_GITHUB_SOURCE_TOKEN","test-only"));
  afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
  it("rejects a failed read-only preflight without suggesting a build may exist",async()=>{
    const fetch=vi.fn().mockRejectedValue(new Error("DNS unavailable"));
    vi.stubGlobal("fetch",fetch);
    expect((await dispatchHostedBuild(input)).kind).toBe("REJECTED");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].method).toBeUndefined();
  });
  it("keeps a timed-out POST uncertain and never repeats it",async()=>{
    const fetch=vi.fn()
      .mockResolvedValueOnce(Response.json({default_branch:"master"}))
      .mockResolvedValueOnce(Response.json({commit:{sha:"a".repeat(40)}}))
      .mockResolvedValueOnce(Response.json({id:1}))
      .mockRejectedValueOnce(new Error("response lost after dispatch"));
    vi.stubGlobal("fetch",fetch);
    expect((await dispatchHostedBuild(input)).kind).toBe("UNKNOWN");
    expect(fetch).toHaveBeenCalledTimes(4);
    expect(fetch.mock.calls.filter(call=>call[1].method==="POST")).toHaveLength(1);
  });
});
