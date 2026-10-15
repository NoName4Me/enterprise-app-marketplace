import {describe,it,expect} from "vitest";
import {monitoredScopes} from "./devops-scope";
import type {ArgoOverview,ArgoApplicationObservation} from "./argocd-model";
const appId="22222222222242228222222222222222";
const uuid="22222222-2222-4222-8222-222222222222";
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
    expect(monitoredScopes(observation([good]),uuid)).toEqual([
      {namespace:good.namespace,environment:"测试环境",container:"web"},
    ]);
    expect(monitoredScopes(observation([{...good,project:"default"}]),uuid)).toEqual([]);
    expect(monitoredScopes(observation([{...good,namespace:"shared"}]),uuid)).toEqual([]);
    expect(monitoredScopes(observation([{...good,environmentKey:"production"}]),uuid)).toEqual([]);
    expect(monitoredScopes(observation([{...good,name:"not-matched"}]),uuid)).toEqual([]);
    expect(monitoredScopes(observation([good],"UNKNOWN"),uuid)).toEqual([]);
  });
  it("preserves explicitly bound legacy lab scope but does not widen",()=>{
    const lab={...good,namespace:"marketplace-lab",name:"marketplace-lab",project:"marketplace-lab"};
    expect(monitoredScopes(observation([lab]),uuid)).toHaveLength(1);
    expect(monitoredScopes(observation([{...lab,namespace:"default"}]),uuid)).toEqual([]);
  });
});
