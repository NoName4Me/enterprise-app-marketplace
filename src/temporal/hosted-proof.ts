type JsonRecord=Record<string,unknown>;
const obj=(value:unknown):JsonRecord=>
  value&&typeof value==="object"&&!Array.isArray(value)?value as JsonRecord:{};
const str=(value:unknown)=>typeof value==="string"?value:"";
const DIGEST=/^ghcr\.io\/[a-z0-9][a-z0-9_.-]*(?:\/[a-z0-9][a-z0-9_.-]*)+@sha256:[a-f0-9]{64}$/;
const SHA=/^[a-f0-9]{40}$/;
/** A trusted current master build must contain the P5 merged commit in its history.
 * Squash/cherry-pick rewriting history is intentionally not accepted as proof. */
export function trustedMergeAncestry(compare:unknown,mergeSha:string,headSha:string):boolean {
  if(!SHA.test(mergeSha)||!SHA.test(headSha))return false;
  const data=obj(compare);
  return str(obj(data.base_commit).sha)===mergeSha &&
    str(obj(data.commits).sha)!==headSha &&
    (data.status==="ahead"||data.status==="identical") &&
    Number.isSafeInteger(data.ahead_by) && Number(data.ahead_by)>=0 &&
    data.behind_by===0;
}
export function trustedRun(run:unknown):boolean{
  const record=obj(run);
  return record.event==="workflow_dispatch"&&record.status==="completed"&&
    record.conclusion==="success"&&
    str(record.path).includes(".github/workflows/marketplace-build.yml");
}
export function trustedBuildImage(deployments:unknown,params:{
  appId:string;runId:string;sha:string;repository:string
}):string|null{
  if(!Array.isArray(deployments))return null;
  const matching=deployments.filter(item=>{
    const data=obj(item),payload=obj(data.payload);
    return data.environment==="marketplace-build-artifact"&&
      String(payload.workflow_run_id)===params.runId &&
      payload.app_id===params.appId && payload.source_sha===params.sha;
  });
  if(matching.length!==1)return null;
  const image=str(obj(obj(matching[0]).payload).image);
  const expected="ghcr.io/"+params.repository.toLowerCase()+"@sha256:";
  return DIGEST.test(image)&&image.startsWith(expected)?image:null;
}
