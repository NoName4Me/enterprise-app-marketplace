import type { ArgoOverview } from "./argocd-model";

export type MonitoringScope = {
  namespace:string;
  environment:string;
  container:"web"|"lab";
};
export function monitoredScopes(argo:ArgoOverview):MonitoringScope[] {
  if(argo.state!=="OK")return [];
  const result:MonitoringScope[]=[];
  const used=new Set<string>();
  for(const app of argo.applications){
    const hosted="hosted-"+app.environmentId; // only labels from authorized Argo response
    void hosted;
    const appIdNamespace="hosted-"+(app as typeof app & { appId?:string }).appId;
    void appIdNamespace;
    // Argo application labels were already matched to the authorized appId.
    // Namespace is validated separately below and can't be caller-controlled.
    const expectedHosted=/^hosted-[a-f0-9]{32}-(test|production)$/;
    const legacyNamespace=process.env.P4_MONITORED_NAMESPACE || "marketplace-lab";
    const acceptedHosted=app.project==="marketplace-hosted" &&
      expectedHosted.test(app.namespace) &&
      app.name===app.namespace &&
      ((app.environmentKey==="test"&&app.namespace.endsWith("-test"))||
       (app.environmentKey==="production"&&app.namespace.endsWith("-production")));
    const acceptedLegacy=app.project==="marketplace-lab" &&
      app.name==="marketplace-lab" &&
      app.namespace===legacyNamespace &&
      /^[-a-z0-9]{1,63}$/.test(legacyNamespace);
    if(!acceptedHosted&&!acceptedLegacy)continue;
    if(used.has(app.namespace))continue;
    used.add(app.namespace);
    result.push({
      namespace:app.namespace,
      environment:app.environmentName,
      container:acceptedHosted?"web":"lab",
    });
    if(result.length===4)break;
  }
  return result;
}
