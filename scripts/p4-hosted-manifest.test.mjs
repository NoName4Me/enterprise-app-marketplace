import { test } from "node:test";
import assert from "node:assert/strict";
import { renderHostedManifest } from "./p4-hosted-manifest.mjs";
const base={
 appId:"22222222-2222-4222-8222-222222222222",
 environmentId:"11111111-1111-4111-8111-111111111111",
 environment:"TEST",nodePort:31015,
 image:"ghcr.io/example/acme@sha256:"+"b".repeat(64),repo:"example/acme",
};
test("each hosted app/environment renders isolated NodePort workload and Argo identity",()=>{
 const a=renderHostedManifest(base);
 const prod=renderHostedManifest({...base,environment:"PRODUCTION",nodePort:31016});
 assert.notEqual(a.namespace,prod.namespace);
 assert.match(a.workload,/kind: Deployment/);
 assert.match(a.workload,/type: NodePort/);
 assert.match(a.workload,/nodePort: 31015/);
 assert.match(a.workload,/image: ghcr.io\/example\/acme@sha256:/);
 assert.match(a.application,/marketplace-app-id: 22222222-2222-4222-8222-222222222222/);
 assert.match(a.application,/marketplace-environment-id: 11111111-1111-4111-8111-111111111111/);
 assert.match(a.application,/project: marketplace-hosted/);
});
test("rejects mutable tags, YAML injection, invalid port and untrusted repository",()=>{
 for(const patch of [
  {image:"ghcr.io/example/acme:latest"},
  {image:"ghcr.io/example/acme@sha256:"+"g".repeat(64)},
  {repo:"example/repo\nfoo: bad"},
  {environment:"staging"},
  {appId:"nope"}, {nodePort:30999},{nodePort:32000},{containerPort:0},
 ]) assert.throws(()=>renderHostedManifest({...base,...patch}));
});
