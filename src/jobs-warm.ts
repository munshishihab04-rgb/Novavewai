import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import type {JobsInput,JobsResult} from './jobs.ts';
export const WARM_CITIES=['Bologna','Milano','Roma','Napoli','Torino'] as const;
export async function warmJobs(options:{cacheDir:string;search:(input:JobsInput,signal:AbortSignal)=>Promise<JobsResult>;now?:()=>number;pause?:(ms:number)=>Promise<unknown>}){
 const now=options.now?.()??Date.now(),day=Math.floor(now/86400000);await mkdir(options.cacheDir,{recursive:true,mode:0o700});
 // Atomic, persistent reservation: interruption does not restart a day's crawl.
 try{await writeFile(join(options.cacheDir,`warm-${day}.done`),new Date(now).toISOString(),{flag:'wx',mode:0o600});}catch(error:any){if(error.code==='EEXIST')return {attempted:0,status:'already_reserved',results:[]};throw error;}
 const results:{city:string;status:string;code?:string}[]=[];const signal=AbortSignal.timeout(180000);
 for(const city of WARM_CITIES){signal.throwIfAborted();if(results.length)await (options.pause??pause)(15000);
 const result=await options.search({query:'ristorazione',city},signal);results.push({city,status:result.status,...(result.code?{code:result.code}:{})});
 if(result.status==='unavailable')break;
 }
 return {attempted:results.length,status:'finished',results};
}
