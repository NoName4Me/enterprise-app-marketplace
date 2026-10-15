#!/usr/bin/env node
// Render a per-application/environment Kubernetes workload. Does not deploy.
import { argv } from "node:process";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE=/^ghcr\.io\/[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)+@sha256:[a-f0-9]{64}$/;
const REPO=/^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9_.-]{1,100}$/;
const EVIDENCE_REPO="https://github.com/NoName4Me/enterprise-app-marketplace.git";
function check(value,message){if(!value)throw new Error(message)}
export function renderHostedManifest(spec){
  const {appId,environmentId,environment,image,repo,nodePort}=spec;
  check(UUID.test(appId),"invalid app UUID");
  check(UUID.test(environmentId),"invalid environment UUID");
  check(environment==="TEST"||environment==="PRODUCTION","invalid environment");
  check(IMAGE.test(image),"use an immutable GHCR image digest");
  check(REPO.test(repo)&&!repo.endsWith("/.")&&!repo.endsWith("/.."),"invalid source GitHub repository");
  check(Number.isInteger(nodePort)&&nodePort>=31000&&nodePort<=31999,"node port out of range");
  const port=spec.containerPort??8080;
  check(Number.isInteger(port)&&port>=1&&port<=65535,"invalid container port");
  const name="hosted-"+appId.toLowerCase().replaceAll("-","");
  const ns=name+"-"+(environment==="TEST"?"test":"production");
  const service="web";
  const labels=[
    "    marketplace-app-id: "+appId.toLowerCase(),
    "    marketplace-environment-id: "+environmentId.toLowerCase(),
  ].join("\n");
  // Every namespace belongs to precisely one app AND environment. The resource
  // labels let the read-only Argo/Prometheus adapters authorize scope.
  const workload=[
    "apiVersion: v1","kind: Namespace","metadata:","  name: "+ns,"  labels:",
    ...labels.split("\n"),"---",
    "apiVersion: apps/v1","kind: Deployment","metadata:","  name: web","  namespace: "+ns,
    "spec:","  replicas: 1","  revisionHistoryLimit: 3","  selector:","    matchLabels:","      app: web",
    "  template:","    metadata:","      labels:","        app: web","    spec:",
    "      containers:","        - name: web","          image: "+image,
    "          ports:","            - containerPort: "+port,"              name: http",
    "          readinessProbe:","            tcpSocket:","              port: http",
    "            initialDelaySeconds: 3","            periodSeconds: 5",
    "          resources:","            requests:","              cpu: 25m","              memory: 64Mi",
    "            limits:","              cpu: 500m","              memory: 512Mi","---",
    "apiVersion: v1","kind: Service","metadata:","  name: "+service,"  namespace: "+ns,
    "spec:","  type: NodePort","  selector:","    app: web",
    "  ports:","    - name: http","      port: 80","      targetPort: http",
    "      nodePort: "+nodePort,"",
  ].join("\n");
  const application=[
    "apiVersion: argoproj.io/v1alpha1","kind: Application","metadata:",
    "  name: "+ns,"  namespace: argocd","  labels:",
    ...labels.split("\n"),"spec:","  project: marketplace-hosted","  source:",
    "    repoURL: "+EVIDENCE_REPO,"    targetRevision: dev",
    "    path: p4/gitops/hosted/"+appId.toLowerCase()+"/"+environment.toLowerCase(),
    "  destination:","    server: https://kubernetes.default.svc",
    "    namespace: "+ns,"  syncPolicy:","    automated:",
    "      prune: false","      selfHeal: true",
    "    syncOptions:","      - CreateNamespace=true","",
  ].join("\n");
  return { namespace:ns, workload, application };
}
if(process.argv[1]&&import.meta.url===new URL("file://"+process.argv[1]).href){
  try {
    const [appId,environmentId,environment,nodePortStr,image,repo,portStr]=argv.slice(2);
    const result=renderHostedManifest({appId,environmentId,environment,
      nodePort:Number(nodePortStr),image,repo,containerPort:portStr?Number(portStr):8080});
    process.stdout.write(result.workload);
    process.stderr.write("Argo Application must be created separately through controlled GitOps bootstrap: "+result.namespace+"\n");
  }catch(err){process.stderr.write(String(err)+"\n");process.exitCode=2;}
}
