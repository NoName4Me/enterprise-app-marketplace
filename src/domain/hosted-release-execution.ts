import {eq} from "drizzle-orm";
import {db} from "@/db/client";
import {applications} from "@/db/schema";
import type {Actor} from "./actor";
import {AppError} from "./app-errors";
import {inspectHostedRelease} from "./hosted-release-service";
import {allowedHostedLogLocation} from "./hosted-log-policy";

const REPO=/^[a-zA-Z0-9-]{1,39}\/[a-zA-Z0-9_.-]{1,100}$/;
const JOB=/^[1-9][0-9]{0,18}$/;
const API="https://api.github.com";
const MAX_JOBS=20;
const MAX_LOG_BYTES=128*1024;

type JobStep={name:string;number:number;status:string;conclusion:string|null;startedAt:string|null;completedAt:string|null};
export type BuildJob={id:number;name:string;status:string;conclusion:string|null;startedAt:string|null;completedAt:string|null;steps:JobStep[]};
type ReadResult={state:"OK"|"NO_BUILD"|"UNAVAILABLE";jobs:BuildJob[];note?:string};

function object(value:unknown):Record<string,unknown>{
  return value && typeof value==="object" && !Array.isArray(value) ? value as Record<string,unknown> : {};
}
function string(value:unknown,limit=120):string{return typeof value==="string"?value.slice(0,limit):"";}
function num(value:unknown):number{return typeof value==="number" && Number.isSafeInteger(value)?value:0;}
function date(value:unknown):string|null{
  const s=string(value,40);return s && !Number.isNaN(Date.parse(s))?s:null;
}
function tokenHeaders():Headers{
  const h=new Headers({"Accept":"application/vnd.github+json","X-GitHub-Api-Version":"2026-03-10",
    "User-Agent":"enterprise-app-marketplace"});
  const token=process.env.HOSTED_GITHUB_LOG_TOKEN?.trim();
  if(token)h.set("Authorization","Bearer "+token);
  return h;
}
async function github(path:string,redirect:RequestRedirect="error"){
  return fetch(API+path,{headers:tokenHeaders(),cache:"no-store",redirect,
    signal:AbortSignal.timeout(10000)});
}
/** Authorize against the platform application, never against a repository from the client. */
async function context(actor:Actor|null,appId:string,releaseId:string){
  const result=await inspectHostedRelease(actor,appId,releaseId);
  const [app]=await db.select({repo:applications.sourceRepository}).from(applications)
    .where(eq(applications.id,appId)).limit(1);
  const repo=app?.repo??"";
  if(!REPO.test(repo)||repo.endsWith("/.")||repo.endsWith("/.."))
    throw new AppError(422,"invalid_hosted_repository");
  return {...result,repo};
}
async function jobsFor(repo:string,runId:string|null):Promise<ReadResult>{
  if(!runId||!JOB.test(runId))return {state:"NO_BUILD",jobs:[]};
  if(!process.env.HOSTED_GITHUB_LOG_TOKEN?.trim())
    return {state:"UNAVAILABLE",jobs:[],note:"请在门户配置 HOSTED_GITHUB_LOG_TOKEN（Actions:read），避免匿名 API 配额限制"};
  try{
    const response=await github("/repos/"+repo+"/actions/runs/"+runId+"/jobs?filter=latest&per_page="+MAX_JOBS);
    if(!response.ok)return {state:"UNAVAILABLE",jobs:[],note:"GitHub 作业状态暂不可读取，请检查日志只读权限"};
    const json=object(await response.json());
    const raw=Array.isArray(json.jobs)?json.jobs.slice(0,MAX_JOBS):[];
    const jobs=raw.map((item:unknown):BuildJob=>{
      const j=object(item);const list=Array.isArray(j.steps)?j.steps.slice(0,80):[];
      return {id:num(j.id),name:string(j.name),status:string(j.status,40),
        conclusion:j.conclusion==null?null:string(j.conclusion,40),
        startedAt:date(j.started_at),completedAt:date(j.completed_at),
        steps:list.map((entry:unknown)=>{const s=object(entry);return {
          number:num(s.number),name:string(s.name),status:string(s.status,40),
          conclusion:s.conclusion==null?null:string(s.conclusion,40),
          startedAt:date(s.started_at),completedAt:date(s.completed_at)
        };})};
    }).filter(j=>j.id>0);
    return {state:"OK",jobs};
  }catch{return {state:"UNAVAILABLE",jobs:[],note:"GitHub 作业状态暂不可读取"};}
}
export async function getHostedExecution(actor:Actor|null,appId:string,releaseId:string){
  const {release,snapshot,repo}=await context(actor,appId,releaseId);
  const build=await jobsFor(repo,release.buildRunId);
  return {release,snapshot,build,observedAt:new Date().toISOString()};
}
async function boundedText(response:Response){
  const reader=response.body?.getReader();
  if(!reader)return {text:"",truncated:false};
  const decoder=new TextDecoder();
  let bytes=0,text="",truncated=false;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.length;
      if(bytes>4*1024*1024)throw new AppError(422,"log_too_large");
      text+=decoder.decode(value,{stream:true});
      if(text.length>MAX_LOG_BYTES){text=text.slice(-MAX_LOG_BYTES);truncated=true;}
    }
    text+=decoder.decode();
    if(text.length>MAX_LOG_BYTES){text=text.slice(-MAX_LOG_BYTES);truncated=true;}
    return {text,truncated};
  }finally{await reader.cancel().catch(()=>{});}
}
export async function readHostedJobLog(actor:Actor|null,appId:string,releaseId:string,jobId:string){
  const {release,repo}=await context(actor,appId,releaseId);
  if(!JOB.test(jobId)||!release.buildRunId)
    throw new AppError(404,"not_found");
  const build=await jobsFor(repo,release.buildRunId);
  if(build.state!=="OK")return {state:"UNAVAILABLE",text:"",note:build.note??"构建作业暂不可读取"};
  if(!build.jobs.some(j=>String(j.id)===jobId))
    throw new AppError(404,"not_found");
  try{
    // GitHub issues a short-lived redirect. Never forward our credential to the signed URL.
    const response=await github("/repos/"+repo+"/actions/jobs/"+jobId+"/logs","manual");
    if(response.status!==302)return {state:"NOT_READY",text:"",note:"GitHub 暂未提供该作业的日志"};
    const target=response.headers.get("location")??"";
    if(!allowedHostedLogLocation(target))return {state:"UNAVAILABLE",text:"",note:"GitHub 日志下载地址未通过安全校验"};
    const file=await fetch(target,{redirect:"error",cache:"no-store",
      signal:AbortSignal.timeout(15000)});
    if(!file.ok)return {state:"NOT_READY",text:"",note:"日志尚未可下载"};
    const log=await boundedText(file);
    return {state:"OK",text:log.text,note:log.truncated?
      "GitHub Actions 作业日志（仅显示末尾约 128 KiB，完整内容请访问 GitHub）":
      "GitHub Actions 作业日志"};
  }catch{return {state:"UNAVAILABLE",text:"",note:"日志读取失败，可通过 GitHub Actions 查看原始记录"};}
}
