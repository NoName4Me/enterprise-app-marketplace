/** GitHub Actions returns a short-lived signed location for job logs.
 * Keep credentials on api.github.com only and never allow an arbitrary redirect.
 */
export function allowedHostedLogLocation(value:string):boolean{
  try{
    const url=new URL(value);
    if(url.protocol!=="https:"||url.username||url.password||url.port)return false;
    const host=url.hostname.toLowerCase();
    return host==="pipelines.actions.githubusercontent.com"||
      host.endsWith(".actions.githubusercontent.com")||
      host.endsWith(".blob.core.windows.net");
  }catch{return false;}
}
