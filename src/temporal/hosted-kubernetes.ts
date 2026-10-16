import {readFileSync} from "node:fs";
import {request as httpsRequest} from "node:https";
import type {HostedReleaseInput,ExternalAction} from "./hosted-contracts";

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[0-9a-f]{12}$/i;
const IMAGE=/^ghcr\.io\/[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)+@sha256:[a-f0-9]{64}$/;
const obj=(x:unknown):Record<string,unknown>=>x&&typeof x==="object"&&!Array.isArray(x)?x as Record<string,unknown>:{};
const arr=(x:unknown):unknown[]=>Array.isArray(x)?x:[];
const number=(x:unknown)=>typeof x==="number"?x:0;
const pathFor=(input:HostedReleaseInput)=>"hosted-"+input.appId.replaceAll("-","")+"-"+input.environment.toLowerCase();
function validate(input:HostedReleaseInput,image?:string){
  if(!UUID.test(input.appId)||!UUID.test(input.environmentId)||
    !["TEST","PRODUCTION"].includes(input.environment)||
    !Number.isInteger(input.nodePort)||input.nodePort<31000||input.nodePort>31999)
    throw new Error("invalid_hosted_scope");
  if(image&&!IMAGE.test(image))throw new Error("invalid_immutable_image");
}
function k8sConfig(){
  const host=process.env.KUBERNETES_SERVICE_HOST?.trim();
  const port=Number(process.env.KUBERNETES_SERVICE_PORT_HTTPS||443);
  if(!host||!/^[a-zA-Z0-9.:-]+$/.test(host)||!Number.isInteger(port)||port<1||port>65535)
    throw new Error("in_cluster_kubernetes_required");
  return {host,port,
    token:readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/token","utf8").trim(),
    ca:readFileSync("/var/run/secrets/kubernetes.io/serviceaccount/ca.crt")};
}
async function kube(method:"GET"|"POST"|"PATCH",path:string,body?:unknown){
  const {host,port,token,ca}=k8sConfig();
  const raw=body===undefined?null:JSON.stringify(body);
  const kind=method==="PATCH"?"application/strategic-merge-patch+json":"application/json";
  return new Promise<{status:number,data:Record<string,unknown>}>((resolve,reject)=>{
    const req=httpsRequest({hostname:host,port,path,method,ca,rejectUnauthorized:true,
      timeout:10000,headers:{Authorization:"Bearer "+token,Accept:"application/json",
        ...(raw?{"Content-Type":kind,"Content-Length":Buffer.byteLength(raw)}:{})}},res=>{
      let size=0;const chunks:Buffer[]=[];
      res.on("data",(b:Buffer)=>{size+=b.length;if(size>128*1024)res.destroy(new Error("kube_response_too_large"));else chunks.push(b);});
      res.on("end",()=>{try{const data=Buffer.concat(chunks).toString("utf8");
        resolve({status:res.statusCode||0,data:data?obj(JSON.parse(data)):{}});
      }catch(e){reject(e);}});
      res.on("error",reject);
    });
    req.on("timeout",()=>req.destroy(new Error("kube_timeout")));
    req.on("error",reject);
    if(raw)req.write(raw);
    req.end();
  });
}
/** Namespace belongs to exactly one portal application and one environment. */
async function checkScope(input:HostedReleaseInput){
  validate(input);
  const ns=pathFor(input);
  const namespace=await kube("GET","/api/v1/namespaces/"+ns);
  if(namespace.status!==200)throw new Error("namespace_not_provisioned");
  const labels=obj(obj(namespace.data.metadata).labels);
  if(labels["marketplace-app-id"]!==input.appId ||
     labels["marketplace-environment-id"]!==input.environmentId)
    throw new Error("namespace_ownership_mismatch");
  return ns;
}
function reason(error:unknown){
  const code=error instanceof Error?error.message:"unknown";
  const messages:Record<string,string>={
    namespace_not_provisioned:"目标命名空间尚未由管理员完成一次性初始化，不能直接部署",
    namespace_ownership_mismatch:"目标命名空间与应用/环境身份不一致",
    in_cluster_kubernetes_required:"Worker 未运行在可授权的 Kubernetes 集群内",
  };
  return messages[code]??"Kubernetes 权限、网络或真实资源状态无法确认；停止并人工核对";
}
export async function preflightHostedKube(input:HostedReleaseInput):Promise<ExternalAction>{
  try{await checkScope(input);return {kind:"ACCEPTED",id:pathFor(input)};}
  catch(e){return {kind:"REJECTED",reason:reason(e)};}
}
export async function applyHostedKube(input:HostedReleaseInput,image:string):Promise<ExternalAction>{
  try{
    validate(input,image);
    const ns=await checkScope(input);
    const depPath="/apis/apps/v1/namespaces/"+ns+"/deployments";
    const svcPath="/api/v1/namespaces/"+ns+"/services";
    const deployment=await kube("GET",depPath+"/web");
    if(deployment.status===404){
      const created=await kube("POST",depPath,{
        apiVersion:"apps/v1",kind:"Deployment",
        metadata:{name:"web",namespace:ns},
        spec:{replicas:1,revisionHistoryLimit:3,selector:{matchLabels:{app:"web"}},
          template:{metadata:{labels:{app:"web"}},spec:{containers:[{
            name:"web",image,ports:[{name:"http",containerPort:8080}],
            readinessProbe:{tcpSocket:{port:"http"},periodSeconds:5,initialDelaySeconds:3},
            resources:{requests:{cpu:"25m",memory:"64Mi"},limits:{cpu:"500m",memory:"512Mi"}}
          }]}}}
      });
      if(created.status!==201)return {kind:created.status>=500?"UNKNOWN":"REJECTED",
        reason:"创建业务 Deployment 未获确认（状态 "+created.status+"），暂停核对"};
    }else if(deployment.status===200){
      const spec=obj(deployment.data.spec);
      if(obj(obj(spec.selector).matchLabels).app!=="web")
        return {kind:"REJECTED",reason:"现有 Deployment 不属于平台预期的 web 应用"};
      const updated=await kube("PATCH",depPath+"/web",{spec:{template:{spec:{containers:[{name:"web",image}]}}}});
      if(updated.status!==200)return {kind:updated.status>=500?"UNKNOWN":"REJECTED",
        reason:"更新 Deployment 镜像未获确认（状态 "+updated.status+"），暂停核对"};
    }else return {kind:"UNKNOWN",reason:"无法读取 Deployment，停止远端写入"};
    const service=await kube("GET",svcPath+"/web");
    if(service.status===404){
      const created=await kube("POST",svcPath,{
        apiVersion:"v1",kind:"Service",metadata:{name:"web",namespace:ns},
        spec:{type:"NodePort",selector:{app:"web"},ports:[{
          name:"http",port:80,targetPort:"http",nodePort:input.nodePort}]}
      });
      if(created.status!==201)return {kind:created.status>=500?"UNKNOWN":"REJECTED",
        reason:"创建业务 Service 未获确认（状态 "+created.status+"），暂停核对"};
    }else if(service.status===200){
      const spec=obj(service.data.spec),ports=arr(spec.ports);
      if(spec.type!=="NodePort"||obj(spec.selector).app!=="web"||
        !ports.some(p=>number(obj(p).nodePort)===input.nodePort))
        return {kind:"REJECTED",reason:"现有 Service 的归属或保留端口不匹配"};
    }else return {kind:"UNKNOWN",reason:"无法读取 Service，停止确认部署"};
    return {kind:"ACCEPTED",id:ns};
  }catch(e){return {kind:"UNKNOWN",reason:reason(e)};}
}
export async function probeHostedKube(input:HostedReleaseInput,image:string):
Promise<{ready:boolean;note:string}>{
  try{
    validate(input,image);
    const ns=pathFor(input);
    const deployment=await kube("GET","/apis/apps/v1/namespaces/"+ns+"/deployments/web");
    const service=await kube("GET","/api/v1/namespaces/"+ns+"/services/web");
    if(deployment.status!==200||service.status!==200)
      return {ready:false,note:"实际 Kubernetes 资源尚不可读"};
    const spec=obj(deployment.data.spec),status=obj(deployment.data.status);
    const meta=obj(deployment.data.metadata);
    const containers=arr(obj(obj(spec.template).spec).containers);
    const replica=number(spec.replicas);
    if(!containers.some(c=>obj(c).name==="web"&&obj(c).image===image)||
      replica<1||number(status.updatedReplicas)!==replica||
      number(status.availableReplicas)<replica||
      number(status.observedGeneration)<number(meta.generation))
      return {ready:false,note:"Deployment 的镜像 Digest 与 Pod 就绪状态未验证"};
    const svc=obj(service.data.spec);
    if(svc.type!=="NodePort"||obj(svc.selector).app!=="web"||
      !arr(svc.ports).some(p=>number(obj(p).nodePort)===input.nodePort))
      return {ready:false,note:"Service NodePort 不符合应用登记"};
    const ip=(process.env.HOSTED_PUBLIC_IP??"").split(".").map(Number);
    if(ip.length!==4||ip.some(n=>!Number.isInteger(n)||n<0||n>255)||
      !(ip[0]===10||(ip[0]===172&&ip[1]>=16&&ip[1]<=31)||(ip[0]===192&&ip[1]===168)))
      return {ready:false,note:"未配置有效的内网固定 IP"};
    const response=await fetch("http://"+ip.join(".")+":"+input.nodePort+"/",{
      redirect:"error",cache:"no-store",signal:AbortSignal.timeout(6000)});
    await response.body?.cancel();
    return {ready:response.ok,note:response.ok?"Deployment、Service 和 HTTP 探测均通过":"容器 HTTP 健康检查尚未通过"};
  }catch{return {ready:false,note:"Kubernetes 资源读取或访问探测暂不可用"};}
}
