import {EventEmitter} from 'node:events';
import WebSocket from 'ws';
import {azureBase,azureToken} from './azure-services.ts';
import {voiceInstructions} from './voice-policy.ts';
export interface SpeechTransport extends EventEmitter {send(event:any):void;close():void}
export interface VoiceProvider {connect(sdp:string,language:string,signal:AbortSignal):Promise<{sdp:string,transport:SpeechTransport}>}
// Realtime is a speech transport, never a second tool agent. Sideband is the
// trusted observation boundary; no browser transcript or assistant text is ingested.
export class AzureSpeechProvider implements VoiceProvider{
 async connect(sdp:string,language:string,signal:AbortSignal){
  const token=await azureToken(signal),session={type:'realtime',model:'gpt-realtime-2.1-mini',output_modalities:['audio'],instructions:voiceInstructions(language).split('CAPABILITIES AND SAFETY:')[0]+'\nTRANSPORT ONLY: Do not answer user requests independently. Only read server-provided canonical responses aloud. No tools.',tools:[],audio:{output:{voice:'marin'},input:{transcription:{model:'whisper-1'},turn_detection:{type:'server_vad',silence_duration_ms:900,prefix_padding_ms:300,create_response:false,interrupt_response:false}}}};
  const secretRes=await fetch(azureBase+'realtime/client_secrets',{method:'POST',redirect:'error',signal,headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({session})});if(!secretRes.ok)throw Error('voice_unavailable');const secret=await secretRes.json() as any;
  const call=await fetch(azureBase+'realtime/calls',{method:'POST',redirect:'error',signal,headers:{authorization:`Bearer ${secret.value}`,'content-type':'application/sdp'},body:sdp});if(!call.ok)throw Error('voice_connection_failed');const answer=await call.text(),location=call.headers.get('location'),id=location?.split('/').pop();if(!id||answer.length>35000)throw Error('voice_sideband_unavailable');
  const ws=new WebSocket(azureBase.replace('https:','wss:')+'realtime?call_id='+encodeURIComponent(id),{headers:{Authorization:`Bearer ${token}`},handshakeTimeout:10000,maxPayload:1048576});
  class Transport extends EventEmitter{send(e:any){if(ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(e))}close(){ws.terminate()}}
  const transport=new Transport();const abort=()=>transport.close();signal.addEventListener('abort',abort,{once:true});
  try{await new Promise<void>((resolve,reject)=>{const timeout=setTimeout(()=>{transport.close();reject(Error('voice_sideband_timeout'))},12000);const failed=()=>{clearTimeout(timeout);reject(Error('voice_sideband_unavailable'))};ws.on('error',failed);ws.on('close',()=>{failed();transport.emit('ended')});ws.on('open',()=>transport.send({type:'session.update',session:{type:'realtime',audio:{input:session.audio.input},tools:[]}}));ws.on('message',bytes=>{try{const e=JSON.parse(bytes.toString());if(e.type==='session.updated'){clearTimeout(timeout);resolve()}transport.emit('event',e)}catch{failed()}})});return {sdp:answer,transport};}catch(e){transport.close();throw e}finally{signal.removeEventListener('abort',abort)}
 }
}
