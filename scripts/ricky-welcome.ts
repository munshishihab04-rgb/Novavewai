import pg from 'pg';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {initWeb} from '../src/web.ts';
const root='/home/azureuser/.local/share/nova-community-trial';
const {owner}=JSON.parse(await readFile(root+'/ricky-invite-metadata.json','utf8'));
const pool=new pg.Pool({host:'127.0.0.1',port:55439,user:'nova_trial',password:await readFile(root+'/db-secret','utf8'),database:'postgres'});
const title='Benvenuto, Ricky.';
const message='Ci tenevo che fossi tu il primo a provare NOVA.\n\nNon sei soltanto il mio carissimo socio: sei il mio mentore, una persona il cui parere per me conta davvero. Per questo volevo aprirti questa porta prima di chiunque altro.\n\nÈ ancora un inizio, con tanto da migliorare. Guardalo con i tuoi occhi, mettilo alla prova e dimmi sinceramente cosa ne pensi.\n\nGrazie per esserci, per quello che mi insegni e per il cammino che condividiamo. Questa prima prova è dedicata a te.';
try{await initWeb(pool);await pool.query('INSERT INTO web_welcomes(owner_id,title,message) VALUES($1,$2,$3) ON CONFLICT(owner_id) DO UPDATE SET title=EXCLUDED.title,message=EXCLUDED.message',[owner,title,message]);const row=(await pool.query('SELECT title,message FROM web_welcomes WHERE owner_id=$1',[owner])).rows[0];assert.deepEqual(row,{title,message});console.log(JSON.stringify({verified:true,title,message,unusedInvites:(await pool.query('SELECT count(*)::int n FROM web_invites WHERE owner_id=$1 AND expires_at>clock_timestamp()',[owner])).rows[0].n}));}finally{await pool.end()}
