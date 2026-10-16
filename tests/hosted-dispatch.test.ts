import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
vi.mock("../src/db/client",()=>({db:{}}));
import {dispatchHostedBuild,registerHostedArgoApp,probeHostedArgo} from "../src/temporal/hosted-activities";
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
  it("sends the Application itself as the Argo REST request body",async()=>{
    vi.stubEnv("ARGOCD_SERVER_URL","http://argocd-server.argocd.svc.cluster.local");
    vi.stubEnv("HOSTED_ARGO_APPLICATION_TOKEN","test-only");
    const ns="hosted-"+input.appId.replaceAll("-","")+"-test";
    const fetch=vi.fn()
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(Response.json({spec:{project:"marketplace-hosted",
        source:{path:"p4/gitops/hosted/"+input.appId+"/test"},destination:{namespace:ns}}}));
    vi.stubGlobal("fetch",fetch);
    expect((await registerHostedArgoApp(input)).kind).toBe("ACCEPTED");
    const body=JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.metadata.name).toBe(ns);
    expect(body.spec.project).toBe("marketplace-hosted");
    expect(body.application).toBeUndefined();
  });
  it.each([true,false])("verifies the live image with no Argo image summary (matching=%s)",async matching=>{
    vi.stubEnv("ARGOCD_SERVER_URL","http://argocd-server.argocd.svc.cluster.local");
    vi.stubEnv("HOSTED_ARGO_APPLICATION_TOKEN","test-only");
    vi.stubEnv("HOSTED_PUBLIC_IP","10.1.2.3");
    const image="ghcr.io/example/test-app@sha256:"+"a".repeat(64);
    const ns="hosted-"+input.appId.replaceAll("-","")+"-test";
    const fetch=vi.fn().mockResolvedValueOnce(Response.json({
      metadata:{labels:{"marketplace-app-id":input.appId,"marketplace-environment-id":input.environmentId}},
      status:{sync:{status:"Synced"},health:{status:"Healthy"},summary:{}}
    })).mockResolvedValueOnce(Response.json({manifest:JSON.stringify({
      metadata:{name:"web",namespace:ns,generation:1},
      spec:{replicas:1,template:{spec:{containers:[{name:"web",image:matching?image:"wrong-image"}]}}},
      status:{observedGeneration:1,replicas:1,updatedReplicas:1,availableReplicas:1}
    })})).mockResolvedValueOnce(Response.json({manifest:JSON.stringify({
      metadata:{name:"web",namespace:ns},spec:{type:"NodePort",selector:{app:"web"},ports:[{nodePort:31000}]}
    })})).mockResolvedValueOnce(new Response("healthy"));
    vi.stubGlobal("fetch",fetch);
    expect((await probeHostedArgo(input,image)).ready).toBe(matching);
    expect(fetch).toHaveBeenCalledTimes(matching?4:2);
    const endpoint=new URL(fetch.mock.calls[1][0]);
    expect(endpoint.pathname.endsWith("/resource")).toBe(true);
    expect(endpoint.searchParams.get("kind")).toBe("Deployment");
  });
});
