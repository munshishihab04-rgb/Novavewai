import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import EmbeddedPostgres from 'embedded-postgres';
import pg from 'pg';
import { buildApp, bootstrap, migrate } from '../src/app.ts';
import { buildWeb, initWeb, issueInvite, webDataRoutes } from '../src/web.ts';
import { ManagedIdentityProvider } from '../src/managed-provider.ts';
const root='/home/azureuser/.local/share/nova-community-trial';
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
const core=buildApp(pool,{fileRoot:root+'/files',agent:{endpoint:'https://sadesheikh-2809-resource.openai.azure.com/openai/v1/chat/completions',model:'gpt-5.4-mini',provider:new ManagedIdentityProvider(),timeoutMs:30000}});webDataRoutes(core,pool);await core.ready();
const web=await buildWeb(core,pool);await web.listen({port:4187,host:'127.0.0.1'});console.log('NOVA trial ready on loopback:4187');
let closing=false;async function stop(){if(closing)return;closing=true;await web.close();await core.close();await pool.end();await embedded.stop()}
process.once('SIGTERM',()=>void stop());process.once('SIGINT',()=>void stop());
