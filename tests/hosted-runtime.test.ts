import {describe,it,expect} from "vitest";
import {observeHostedWorkload} from "../src/domain/hosted-runtime-model";
const digest="ghcr.io/noname4me/demo@sha256:"+"a".repeat(64);
const namespace="hosted-22222222222242228222222222222222-production";
const deployment={
  metadata:{name:"web",namespace,generation:3},
  spec:{replicas:1,selector:{matchLabels:{app:"web"}},
    template:{spec:{containers:[{name:"web",image:digest}]}}},
  status:{observedGeneration:3,updatedReplicas:1,availableReplicas:1}
};
const service={metadata:{name:"web",namespace},spec:{type:"NodePort",selector:{app:"web"},
  ports:[{name:"http",nodePort:31010}]}};
const expected={namespace,nodePort:31010,digest};
describe("direct Kubernetes app runtime interpretation",()=>{
  it("reports ready only when actual Deployment and Service match the verified digest",()=>{
    expect(observeHostedWorkload(deployment,service,expected)).toMatchObject({
      ready:true,image:digest,available:1,desired:1,servicePort:31010
    });
  });
  it("refuses an old or unverified image",()=>{
    expect(observeHostedWorkload(deployment,service,{...expected,digest:digest.replace(/a/g,"b")} ).ready).toBe(false);
    expect(observeHostedWorkload(deployment,service,{...expected,digest:null}).ready).toBe(false);
  });
  it("refuses a namespace or NodePort belonging to another application",()=>{
    expect(observeHostedWorkload(deployment,service,{...expected,namespace:namespace+"-other"}).ready).toBe(false);
    expect(observeHostedWorkload(deployment,service,{...expected,nodePort:31011}).ready).toBe(false);
  });
  it("does not call deploying pod ready before the controller observes the rollout",()=>{
    expect(observeHostedWorkload({...deployment,status:{...deployment.status,observedGeneration:2}},
      service,expected).ready).toBe(false);
    expect(observeHostedWorkload({...deployment,status:{...deployment.status,availableReplicas:0}},
      service,expected).ready).toBe(false);
  });
});
