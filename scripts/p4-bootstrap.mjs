#!/usr/bin/env node
// Produce Argo CD Application manifests; no cluster changes.
import { argv } from "node:process";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const [appId, environmentId] = argv.slice(2);
if (!UUID.test(appId || "") || !UUID.test(environmentId || "")) {
  console.error("Usage: node scripts/p4-bootstrap.mjs <application-uuid> <environment-uuid>");
  process.exit(2);
}
const lines = [
  "apiVersion: argoproj.io/v1alpha1", "kind: AppProject",
  "metadata:", "  name: marketplace-lab", "  namespace: argocd",
  "spec:", "  sourceRepos:", "    - https://github.com/NoName4Me/enterprise-app-marketplace.git",
  "  destinations:", "    - namespace: marketplace-lab", "      server: https://kubernetes.default.svc",
  "  clusterResourceWhitelist:", '    - group: ""', "      kind: Namespace",
  "  namespaceResourceWhitelist:", '    - group: "*"', '      kind: "*"',
  "---", "apiVersion: argoproj.io/v1alpha1", "kind: Application",
  "metadata:", "  name: marketplace-lab", "  namespace: argocd", "  labels:",
  "    marketplace-app-id: " + appId.toLowerCase(),
  "    marketplace-environment-id: " + environmentId.toLowerCase(),
  "spec:", "  project: marketplace-lab",
  "  source:", "    repoURL: https://github.com/NoName4Me/enterprise-app-marketplace.git",
  "    targetRevision: dev", "    path: p4/gitops/lab",
  "  destination:", "    server: https://kubernetes.default.svc", "    namespace: marketplace-lab",
  "  syncPolicy:", "    automated:", "      prune: false", "      selfHeal: true",
  "    syncOptions:", "      - CreateNamespace=true",
];
process.stdout.write(lines.join("\n") + "\n");
