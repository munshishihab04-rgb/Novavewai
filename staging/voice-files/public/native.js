'use strict';
// Candidate asset only. Load AFTER app.js/features.js/dashboard.js on deployment.
// No browser transcript is ever posted as user or assistant text.
let nativeVoiceId=null,nativeVoiceConversation=null,nativeVoicePoll=null;
const releaseVoiceMedia=stopVoice;
stopVoice=function(){const id=nativeVoiceId,conversation=nativeVoiceConversation;nativeVoiceId=null;nativeVoiceConversation=null;clearTimeout(nativeVoicePoll);releaseVoiceMedia();if(id)void api('/voice/sessions/'+id+'/stop',{},'POST',crypto.randomUUID()).catch(()=>notice('Audio spento. Chiusura server non confermata; scade automaticamente.'));if(conversation===current&&!busy&&!dirty){const viewEpoch=epoch,mediaEpoch=voiceEpoch;void messages(conversation).then(list=>{if(current===conversation&&epoch===viewEpoch&&voiceEpoch===mediaEpoch&&!busy&&!dirty)renderMessages(list);}).catch(()=>{});}};
voiceScope.textContent='Stessa conversazione e strumenti della chat · turni salvati';
voiceHint.textContent='Parla con Nova e ritrova qui il lavoro salvato.';
voiceStart.onclick=async()=>{
 const e=++voiceEpoch;voiceStart.disabled=true;voiceLanguage.disabled=true;setVoiceState('connecting','Consenti l’accesso al microfono');
 try{
  if(dirty)throw Error('unsaved');
  if(!current){const viewEpoch=epoch;const c=await api('/conversations',{title:'Conversazione vocale'},'POST',crypto.randomUUID());if(e!==voiceEpoch)return;if(viewEpoch!==epoch||current){stopVoice();return;}current=c.id;sequence=0;task=null;run=null;mode('work');$('#messages').replaceChildren();$('#title').textContent=c.title||'Conversazione vocale';$('#crumb').textContent=$('#title').textContent;}
  nativeVoiceConversation=current;const conversation=current;
  const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true}});if(e!==voiceEpoch){stream.getTracks().forEach(t=>t.stop());return}voiceStream=stream;
  const peer=new RTCPeerConnection();voicePeer=peer;stream.getTracks().forEach(t=>peer.addTrack(t,stream));peer.ontrack=event=>{if(e!==voiceEpoch)return;voiceAudio.srcObject=event.streams[0];voiceAudio.play().catch(()=>{if(e===voiceEpoch)voicePlayback.hidden=false})};
  const channel=peer.createDataChannel('oai-events');voiceChannel=channel;
  channel.onopen=()=>{if(e!==voiceEpoch)return;voiceMute.disabled=false;voiceStart.hidden=true;setVoiceState('listening');voicePrivacy.textContent='Microfono attivo · trascrizione salvata nella conversazione';};
  channel.onmessage=event=>{if(e!==voiceEpoch)return;try{const d=JSON.parse(event.data);if(d.type==='input_audio_buffer.speech_started')setVoiceState('listening','Ti ascolto');if(d.type==='input_audio_buffer.speech_stopped')setVoiceState('thinking');if(d.type==='output_audio_buffer.started')setVoiceState('speaking');if(['output_audio_buffer.stopped','output_audio_buffer.cleared'].includes(d.type))setVoiceState('listening');}catch{}};
  peer.onconnectionstatechange=()=>{if(e===voiceEpoch&&['failed','disconnected','closed'].includes(peer.connectionState)){stopVoice();setVoiceState('error','Audio interrotto · lavoro salvato disponibile in chat')}};
  await peer.setLocalDescription(await peer.createOffer());const requestKey=crypto.randomUUID();sessionStorage.setItem('nova.voice.request',requestKey);let result;
 try{result=await api('/voice/sessions',{conversationId:conversation,sdp:peer.localDescription.sdp,language:voiceLanguage.value},'POST',requestKey)}
 catch(err){// Lost acknowledgement: recover the reserved session id read-only by key and close it. Never reconnect blindly.
  if(err.message==='network'||err.message==='voice_pending'){try{const pending=await api('/voice/sessions?requestKey='+requestKey);if(pending?.id)void api('/voice/sessions/'+pending.id+'/stop',{},'POST',crypto.randomUUID()).catch(()=>{})}catch{}}
  throw err}
 finally{sessionStorage.removeItem('nova.voice.request')}
  if(e!==voiceEpoch){void api('/voice/sessions/'+result.id+'/stop',{},'POST',crypto.randomUUID()).catch(()=>{});return}
  nativeVoiceId=result.id;await peer.setRemoteDescription({type:'answer',sdp:result.sdp});if(e!==voiceEpoch)return;voiceTimer=setTimeout(stopVoice,result.maxSeconds*1000);void syncNativeVoice(e,conversation,result.id);
 }catch(err){if(e===voiceEpoch){stopVoice();setVoiceState('error','Voce non avviata');voiceHint.textContent='Nessun risultato inventato. Puoi continuare nella chat.'}}
};
async function syncNativeVoice(e,conversation,id){if(e!==voiceEpoch)return;try{
 const state=await api('/voice/sessions/'+id);if(e!==voiceEpoch)return;if(state.status!=='active'){stopVoice();setVoiceState('error','Sessione conclusa · riapri per continuare');return}
 const list=await messages(conversation);if(e!==voiceEpoch)return;
 voiceCaptions.replaceChildren();for(const m of list.slice(-8))voiceCaptions.append(elt('p',m.role==='assistant'?'NOVA':'TU','caption-label'),elt('p',m.text,'caption-text'));
 nativeVoicePoll=setTimeout(()=>syncNativeVoice(e,conversation,id),900);
 }catch{if(e===voiceEpoch){stopVoice();setVoiceState('error','Connessione non confermata · riapri la chat')}}}
// Rebind existing handlers that captured the old function before this asset.
voicePanel.addEventListener('cancel',()=>stopVoice());window.addEventListener('pagehide',()=>{const id=nativeVoiceId;nativeVoiceId=null;clearTimeout(nativeVoicePoll);releaseVoiceMedia();if(id)void fetch('/api/voice/sessions/'+id+'/stop',{method:'POST',keepalive:true,credentials:'same-origin',headers:{'content-type':'application/json','x-nova-request':'1'},body:'{}'}).catch(()=>{})});
$('#file').removeAttribute('accept');
$('#file').onchange=function(){stageAttachment(this.files[0]);this.value=''};
// Native completed run does not necessarily mean its task was completed.
const savedSend=send;send=async function(from){if(task&&run?.status==='completed'&&from==='#chatinput'){try{const savedTask=await api('/tasks/'+task);if(['active','paused','created'].includes(savedTask.status))run={...run,status:'waiting_user'};}catch{notice('Non posso verificare il lavoro precedente. Riapri la conversazione.');return}}return savedSend(from)};
const savedOpenArtifact=openArtifact;
openArtifact=async function(...args){await savedOpenArtifact(...args);if(revision?.content.file){const f=revision.content.file;$('#artifacttext').textContent=f.format==='zip'?f.entries.map(x=>x.name).join('\n'):revision.content.text;$('#revisionlabel').textContent=`Versione ${revision.revision} · ${f.name} · non eseguito`;$('#download').textContent='Scarica '+f.name;}}
async function downloadGenerated(){if(!artifact||!revision?.content.file||dirty)return;const f=revision.content.file;const response=await fetch(`/api/artifacts/${artifact.id}/revisions/${revision.revision}/download`,{credentials:'same-origin'});if(!response.ok){notice('Download non riuscito. La versione resta salvata.');return}download(await response.arrayBuffer(),f.name,'application/octet-stream')}
document.addEventListener('click',e=>{const b=e.target.closest('button[data-action]');if(!b)return;if(b.dataset.action==='download'&&revision?.content.file){e.stopImmediatePropagation();e.preventDefault();void downloadGenerated()}if(b.dataset.action==='edit'&&revision?.content.file){e.stopImmediatePropagation();e.preventDefault();notice('Per modificare questo file chiedi a Nova una nuova versione nella chat.')}} ,true);
const savedRenderCards=renderCards;renderCards=function(){savedRenderCards();for(const a of workspace.artifacts.filter(x=>x.conversation_id===current&&x.file)){const card=[...$('#messages').querySelectorAll('.resultcard')].find(x=>x.querySelector('strong')?.textContent===a.title);if(card){const link=elt('a','Scarica file generato');link.href=`/api/artifacts/${a.id}/revisions/${a.current_revision}/download`;link.download='';link.onclick=async event=>{event.preventDefault();try{const response=await fetch(link.href,{credentials:'same-origin'});if(!response.ok)throw Error();download(await response.arrayBuffer(),a.file.name,'application/octet-stream')}catch{notice('Download non riuscito. La versione resta salvata.')}};card.append(link)}}};
