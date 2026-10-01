import type { PoolClient } from 'pg';
import { randomUUID } from 'node:crypto';
import { canonical, hash, event, fail } from './app.ts';
export async function createArtifact(c: PoolClient, owner: string, body: any) {
    if (!(await c.query('SELECT 1 FROM tasks WHERE owner_id=$1 AND id=$2', [owner, body.taskId])).rowCount) fail(404, 'not_found');
    const id = randomUUID(), digest = hash(canonical(body.content));
    await c.query('INSERT INTO artifacts(id,owner_id,task_id,title,current_revision) VALUES($1,$2,$3,$4,1)', [id, owner, body.taskId, body.title]);
    await c.query('INSERT INTO artifact_revisions(owner_id,artifact_id,revision,content,hash) VALUES($1,$2,1,$3,$4)', [owner, id, body.content, digest]);
    await event(c, owner, 'artifact.created', id);
    return { id, revision: 1, content: body.content, hash: digest };
}
export async function reviseArtifact(c: PoolClient, owner: string, id: string, body: any) {
    const artifact = (await c.query('SELECT current_revision FROM artifacts WHERE owner_id=$1 AND id=$2 FOR UPDATE', [owner, id])).rows[0];
    if (!artifact) fail(404, 'not_found');
    if (artifact.current_revision !== body.baseRevision) fail(409, 'revision_conflict');
    const revision = artifact.current_revision + 1, digest = hash(canonical(body.content));
    await c.query('INSERT INTO artifact_revisions(owner_id,artifact_id,revision,content,hash) VALUES($1,$2,$3,$4,$5)', [owner, id, revision, body.content, digest]);
    await c.query('UPDATE artifacts SET current_revision=$3 WHERE owner_id=$1 AND id=$2', [owner, id, revision]);
    await event(c, owner, 'artifact.revised', id);
    return { id, revision, content: body.content, hash: digest };
}
