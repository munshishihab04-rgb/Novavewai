import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { buildApp, bootstrap, migrate } from '../src/app.ts';
import { sweepEphemeral } from '../src/context.ts';
import { buildWeb, initWeb, issueInvite, webDataRoutes, registrationOpenFromEnv } from '../src/web.ts';
import { accountLimitsFromEnv } from '../src/accounts.ts';
import {ProviderRegistry} from '../src/provider-registry.ts';
import {searchWeb} from '../src/azure-services.ts';
import { capabilityRoutes } from '../src/capabilities.ts';
import {AzureSpeechProvider} from '../src/voice-provider.ts';
import { ManagedIdentityProvider } from '../src/managed-provider.ts';
const root=process.env.NOVA_TRIAL_DIR??(process.env.HOME??'/home/azureuser')+'/.local/share/nova-community-trial';
await mkdir(root,{recursive:true,mode:0o700});
await mkdir(root+'/files',{recursive:true,mode:0o700});
let password:string;try{password=await readFile(root+'/db-secret','utf8')}catch{password=randomBytes(32).toString('hex');await writeFile(root+'/db-secret',password,{mode:0o600,flag:'wx'})}
const embedded=new EmbeddedPostgres({databaseDir:root+'/db',user:'nova_trial',password,port:55439,persistent:true,authMethod:'scram-sha-256',postgresFlags:['-h','127.0.0.1','-k',root],onLog:()=>{},onError:()=>{}});
try{await access(root+'/db/PG_VERSION')}catch{await embedded.initialise()}
await embedded.start();
const pool=new pg.Pool({host:'127.0.0.1',port:55439,user:'nova_trial',password,database:'postgres',max:15,connectionTimeoutMillis:5000});
await migrate(pool);await initWeb(pool);
let owner:string;try{owner=await readFile(root+'/owner-id','utf8')}catch{const user=await bootstrap(pool);owner=user.userId;await pool.query('DELETE FROM sessions WHERE owner_id=$1',[owner]);await writeFile(root+'/owner-id',owner,{mode:0o600,flag:'wx'})}
if(process.argv.includes('--invite')){const token=await issueInvite(pool,owner,86400);await writeFile(root+'/invite',token,{mode:0o600});await pool.end();await embedded.stop();console.log('Private invite generated, valid 24h');process.exit(0)}
let providerKey:Buffer;try{providerKey=await readFile(root+'/provider-key')}catch{providerKey=randomBytes(32);await writeFile(root+'/provider-key',providerKey,{mode:0o600,flag:'wx'})}if(providerKey.length!==32)throw Error('Invalid provider encryption key');
const registry=new ProviderRegistry(pool,providerKey);
// Public access: NOVA_DAILY_RUNS_PER_ACCOUNT (default 60), NOVA_UNLIMITED_OWNERS (comma-separated uuids: trial owner, Ricky), NOVA_PUBLIC_REGISTRATION=off to close sign-ups. Read once at startup; invalid values abort.
const accountLimits=accountLimitsFromEnv();
const core=buildApp(pool,{fileRoot:root+'/files',agent:{endpoint:'https://sadesheikh-2809-resource.openai.azure.com/openai/v1/chat/completions',model:'gpt-5.4-mini',provider:new ManagedIdentityProvider(),voice:new AzureSpeechProvider(),registry,search:searchWeb,timeoutMs:30000,...accountLimits}});registry.routes(core);webDataRoutes(core,pool);capabilityRoutes(core,pool);await core.ready();
const basePath=(process.env.NOVA_BASE_PATH??'').trim();const port=Number(process.env.NOVA_PORT??4187);if(!Number.isInteger(port)||port<1024||port>65535)throw Error('NOVA_PORT invalid');
const web=await buildWeb(core,pool,{nativeVoice:true,registration:registrationOpenFromEnv(),basePath});await web.listen({port,host:'127.0.0.1'});console.log(`NOVA trial ready on loopback:${port}${basePath}  (registration ${registrationOpenFromEnv()?'open':'closed'}, ${accountLimits.dailyRunsPerAccount} runs/day, ${accountLimits.unlimitedOwners.length} unlimited owners)`);
// Temporary conversations expire after 24h; blobs go through file_cleanup. Sweep hourly, never crash the server on a sweep error.
const sweeper=setInterval(()=>{sweepEphemeral(pool).then(n=>{if(n)console.log(`ephemeral sweep removed ${n}`)}).catch(e=>console.error('ephemeral sweep failed',e?.message))},3600000);
let closing=false;async function stop(){if(closing)return;closing=true;clearInterval(sweeper);await web.close();await core.close();await pool.end();await embedded.stop()}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
