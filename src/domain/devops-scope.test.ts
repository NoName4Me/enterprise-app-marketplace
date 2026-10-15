import {describe,it,expect} from "vitest";
import {monitoredScopes} from "./devops-scope";
import type {ArgoOverview,ArgoApplicationObservation} from "./argocd-model";
const appId="22222222222242228222222222222222";
const good:ArgoApplicationObservation={
  name:"hosted-"+appId+"-test",project:"marketplace-hosted",
  namespace:"hosted-"+appId+"-test",environmentId:"11111111-1111-4111-8111-111111111111",
  environmentName:"测试环境",environmentKey:"test",sync:"Synced",health:"Healthy",
  desiredRevision:null,lastSyncedRevision:null,lastSyncedAt:null,operationPhase:null,images:[],
};
function observation(applications:ArgoApplicationObservation[],state:"OK"|"UNKNOWN"="OK"):ArgoOverview{
  return {source:"Argo CD Applications API",observedAt:"2026-10-15",state,applications,
    environments:[],dashboardUrl:null,truncated:false};
}
describe("per-app observation scoping",()=>{
  it("only accepts namespaced deployments with authorized project and environment",()=>{
    expect(monitoredScopes(observation([good]))).toEqual([
      {namespace:good.namespace,environment:"测试环境",container:"web"},
    ]);
    expect(monitoredScopes(observation([{...good,project:"default"}]))).toEqual([]);
    expect(monitoredScopes(observation([{...good,namespace:"shared"}]))).toEqual([]);
    expect(monitoredScopes(observation([{...good,environmentKey:"production"}]))).toEqual([]);
    expect(monitoredScopes(observation([{...good,name:"not-matched"}]))).toEqual([]);
    expect(monitoredScopes(observation([good],"UNKNOWN"))).toEqual([]);
  });
  it("preserves explicitly bound legacy lab scope but does not widen",()=>{
    const lab={...good,namespace:"marketplace-lab",name:"marketplace-lab",project:"marketplace-lab"};
    expect(monitoredScopes(observation([lab]))).toHaveLength(1);
    expect(monitoredScopes(observation([{...lab,namespace:"default"}]))).toEqual([]);
  });
});
