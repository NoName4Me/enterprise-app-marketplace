#!/usr/bin/env bash
# Operator-only, incremental RBAC provisioning. Does not delete workloads, Argo apps, or volumes.
set -euo pipefail
if [[ $# -ne 3 ]]; then
  echo "Usage: $0 <app-uuid> <environment-uuid> <TEST|PRODUCTION>" >&2
  exit 2
fi
APP_ID="$1"
ENV_ID="$2"
ENVIRONMENT="$3"
UUID='^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
[[ "$APP_ID" =~ $UUID && "$ENV_ID" =~ $UUID ]] || { echo "Invalid UUID" >&2; exit 2; }
[[ "$ENVIRONMENT" == TEST || "$ENVIRONMENT" == PRODUCTION ]] || { echo "Invalid environment" >&2; exit 2; }
NAMESPACE="hosted-${APP_ID//-/}-${ENVIRONMENT,,}"
kubectl create serviceaccount portal-hosted-worker -n marketplace --dry-run=client -o yaml | kubectl apply -f -
kubectl create clusterrole portal-hosted-namespace-reader --verb=get --resource=namespaces --dry-run=client -o yaml | kubectl apply -f -
kubectl create clusterrolebinding portal-hosted-namespace-reader --clusterrole=portal-hosted-namespace-reader \
  --serviceaccount=marketplace:portal-hosted-worker --dry-run=client -o yaml | kubectl apply -f -
if kubectl get namespace "$NAMESPACE" >/dev/null 2>&1; then
  CURRENT_APP=$(kubectl get namespace "$NAMESPACE" -o jsonpath='{.metadata.labels.marketplace-app-id}')
  CURRENT_ENV=$(kubectl get namespace "$NAMESPACE" -o jsonpath='{.metadata.labels.marketplace-environment-id}')
  if [[ -n "$CURRENT_APP" && "$CURRENT_APP" != "$APP_ID" ]] ||
     [[ -n "$CURRENT_ENV" && "$CURRENT_ENV" != "$ENV_ID" ]]; then
     echo "Existing namespace is owned by another application/environment" >&2
     exit 3
  fi
else
  kubectl create namespace "$NAMESPACE"
fi
kubectl label namespace "$NAMESPACE" \
  "marketplace-app-id=$APP_ID" "marketplace-environment-id=$ENV_ID" --overwrite
kubectl -n "$NAMESPACE" create role portal-hosted-deployer \
  --verb=get,list,create,patch --resource=deployments.apps,services \
  --dry-run=client -o yaml | kubectl apply -f -
kubectl -n "$NAMESPACE" create rolebinding portal-hosted-deployer \
  --role=portal-hosted-deployer \
  --serviceaccount=marketplace:portal-hosted-worker \
  --dry-run=client -o yaml | kubectl apply -f -
echo "Provisioned scoped rights: $NAMESPACE (workloads unchanged)"
