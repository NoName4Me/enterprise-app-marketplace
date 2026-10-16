export type HostedEnvironment="PRODUCTION"|"TEST";
export type HostedRuntimeState="READY"|"DEPLOYING"|"DEGRADED"|"NOT_DEPLOYED"|"UNKNOWN";

function obj(x:unknown):Record<string,unknown>{
  return x!==null&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:{};
}
function count(x:unknown){return typeof x==="number"&&Number.isSafeInteger(x)&&x>=0?x:0;}
function text(x:unknown){return typeof x==="string"?x:"";}

export type WorkloadObservation={
  image:string|null;desired:number;updated:number;available:number;
  generation:number;observedGeneration:number;servicePort:number|null;
  ready:boolean;reason:string;
};
/** Compare actual Kubernetes state to this app's DB-reserved port and immutable image. */
export function observeHostedWorkload(deployment:unknown,service:unknown,expected:{
  namespace:string;nodePort:number;digest:string|null
}):WorkloadObservation {
  const d=obj(deployment),metadata=obj(d.metadata),spec=obj(d.spec),status=obj(d.status);
  const containers=obj(obj(spec.template).spec).containers;
  const web=Array.isArray(containers)?containers.map(obj).find(c=>c.name==="web"):undefined;
  const image=text(web?.image)||null;
  const desired=count(spec.replicas),updated=count(status.updatedReplicas),available=count(status.availableReplicas);
  const generation=count(metadata.generation),observedGeneration=count(status.observedGeneration);
  const s=obj(service),serviceSpec=obj(s.spec),ports=serviceSpec.ports;
  const servicePort=Array.isArray(ports)
    ? ports.map(obj).map(p=>count(p.nodePort)).find(x=>x>0)??null:null;
  const validService=obj(s.metadata).name==="web"&&obj(s.metadata).namespace===expected.namespace&&
    serviceSpec.type==="NodePort"&&obj(serviceSpec.selector).app==="web"&&
    servicePort===expected.nodePort;
  const validDeployment=metadata.name==="web"&&metadata.namespace===expected.namespace&&
    obj(spec.selector).matchLabels!==undefined&&obj(obj(spec.selector).matchLabels).app==="web";
  const healthyDeployment=validDeployment&&desired>0&&generation>0&&observedGeneration>=generation&&
    updated===desired&&available>=desired;
  const digestMatches=!!expected.digest&&image===expected.digest;
  const ready=healthyDeployment&&validService&&digestMatches;
  const reason=!validDeployment?"Deployment 归属不匹配":
    !validService?"Service/NodePort 不匹配":
    !expected.digest?"没有经过 TEST/PRODUCTION 发布验证的镜像记录":
    !digestMatches?"实际运行镜像与发布版本不一致":
    !healthyDeployment?"Deployment 正在更新或 Pod 尚未就绪":"Kubernetes 资源和镜像已匹配";
  return {image,desired,updated,available,generation,observedGeneration,servicePort,ready,reason};
}
export function environmentLabel(env:HostedEnvironment){return env==="PRODUCTION"?"生产环境":"测试环境";}
