// Self-service accounts: username/password credentials on top of the existing
// users/sessions model. No new dependencies: node:crypto scrypt only.
import { randomBytes, randomUUID, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { hash, transaction } from './app.ts';

export const USERNAME_PATTERN = /^[a-z0-9_.-]{3,32}$/;
export const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32, maxmem: 64 * 1024 * 1024 } as const;
export const SESSION_SECONDS = 7 * 86400;
export const normalizeUsername = (v: unknown) => typeof v === 'string' ? v.trim().toLowerCase() : '';
export const validUsername = (v: string) => USERNAME_PATTERN.test(v);
export const validPassword = (v: unknown): v is string => typeof v === 'string' && v.length >= 10 && v.length <= 200;

const scrypt = (password: string, salt: Buffer) => new Promise<Buffer>((resolve, reject) =>
  scryptCallback(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p, maxmem: SCRYPT.maxmem }, (e, key) => e ? reject(e) : resolve(key)));
// Test-observable counter: proves the unknown-user path still pays the scrypt cost.
export const scryptStats = { verifications: 0, dummyVerifications: 0 };

export async function hashPassword(password: string) {
  const salt = randomBytes(32);
  const key = await scrypt(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64url')}$${key.toString('base64url')}`;
}
export async function verifyPassword(password: string, stored: string) {
  scryptStats.verifications++;
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, r, p, salt, expected] = parts;
  if (Number(n) !== SCRYPT.N || Number(r) !== SCRYPT.r || Number(p) !== SCRYPT.p) return false;
  const expectedBytes = Buffer.from(expected, 'base64url');
  if (expectedBytes.length !== SCRYPT.keylen) return false;
  const key = await scrypt(password, Buffer.from(salt, 'base64url'));
  return timingSafeEqual(key, expectedBytes);
}
// Fixed dummy hash (random password at startup) so a login for an unknown
// username costs the same scrypt work as a wrong password for a known one.
let dummy: Promise<string> | undefined;
export async function verifyAgainstDummy(password: string) {
  dummy ??= hashPassword(randomBytes(24).toString('base64url'));
  scryptStats.dummyVerifications++;
  await verifyPassword(password, await dummy);
  return false;
}

export type RegisterResult = { ok: true; ownerId: string; session: string } | { ok: false; error: 'invalid_username' | 'weak_password' | 'username_taken' };
export async function registerAccount(pool: Pool, rawUsername: unknown, password: unknown): Promise<RegisterResult> {
  const username = normalizeUsername(rawUsername);
  if (!validUsername(username)) return { ok: false, error: 'invalid_username' };
  if (!validPassword(password)) return { ok: false, error: 'weak_password' };
  const passwordHash = await hashPassword(password);
  return transaction(pool, async c => {
    if ((await c.query('SELECT 1 FROM account_credentials WHERE username=$1', [username])).rowCount) return { ok: false as const, error: 'username_taken' as const };
    const ownerId = randomUUID();
    await c.query('INSERT INTO users(id) VALUES($1)', [ownerId]);
    try { await c.query('INSERT INTO account_credentials(owner_id,username,password_hash) VALUES($1,$2,$3)', [ownerId, username, passwordHash]); }
    catch (e: any) { if (e?.code === '23505') return { ok: false as const, error: 'username_taken' as const }; throw e; }
    const session = await openSession(c, ownerId);
    return { ok: true as const, ownerId, session };
  });
}
export async function openSession(c: PoolClient, ownerId: string) {
  const session = randomBytes(32).toString('base64url');
  await c.query("INSERT INTO sessions(token_hash,owner_id,expires_at) VALUES($1,$2,clock_timestamp()+$3*interval '1 second')", [hash(session), ownerId, SESSION_SECONDS]);
  return session;
}
export async function loginAccount(pool: Pool, rawUsername: unknown, password: unknown): Promise<{ ok: true; ownerId: string; session: string } | { ok: false }> {
  const username = normalizeUsername(rawUsername);
  const usable = validUsername(username) && validPassword(password);
  const row = usable ? (await pool.query("SELECT c.owner_id,c.password_hash FROM account_credentials c JOIN users u ON u.id=c.owner_id WHERE c.username=$1 AND u.status='active'", [username])).rows[0] : undefined;
  const candidate = typeof password === 'string' ? password : '';
  const valid = row ? await verifyPassword(candidate, row.password_hash) : await verifyAgainstDummy(candidate);
  if (!valid || !row) return { ok: false };
  return transaction(pool, async c => {
    if (!(await c.query("SELECT 1 FROM users WHERE id=$1 AND status='active' FOR UPDATE", [row.owner_id])).rowCount) return { ok: false as const };
    const session = await openSession(c, row.owner_id);
    await c.query('UPDATE account_credentials SET last_login_at=clock_timestamp() WHERE owner_id=$1', [row.owner_id]);
    return { ok: true as const, ownerId: row.owner_id as string, session };
  });
}

// Sliding-window counters keyed by caller-defined strings; memory bounded.
export class Throttle {
  private buckets = new Map<string, { at: number; n: number }>();
  constructor(private limit: number, private windowMs: number, private maxKeys = 5000) {}
  /** Returns seconds to wait when blocked, otherwise 0. Does not count. */
  blocked(key: string) { const b = this.buckets.get(key), now = Date.now(); if (!b || now - b.at > this.windowMs) return 0; return b.n >= this.limit ? Math.max(1, Math.ceil((b.at + this.windowMs - now) / 1000)) : 0; }
  /** Counts one attempt; returns seconds to wait when the attempt exceeds the limit. */
  hit(key: string) { const now = Date.now(); if (this.buckets.size > this.maxKeys) this.buckets.clear(); let b = this.buckets.get(key); if (!b || now - b.at > this.windowMs) { b = { at: now, n: 0 }; this.buckets.set(key, b); } b.n++; return b.n > this.limit ? Math.max(1, Math.ceil((b.at + this.windowMs - now) / 1000)) : 0; }
  reset(key: string) { this.buckets.delete(key); }
}

// Per-account daily run cap (cost guard). Read once at startup from env; no ids in code.
export interface AccountLimits { dailyRunsPerAccount: number; unlimitedOwners: string[] }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export function accountLimitsFromEnv(env: Record<string, string | undefined> = process.env): AccountLimits {
  const raw = env.NOVA_DAILY_RUNS_PER_ACCOUNT;
  const dailyRunsPerAccount = raw === undefined || raw === '' ? 60 : Number(raw);
  if (!Number.isInteger(dailyRunsPerAccount) || dailyRunsPerAccount < 1 || dailyRunsPerAccount > 100000) throw new Error('NOVA_DAILY_RUNS_PER_ACCOUNT must be an integer between 1 and 100000');
  const unlimitedOwners = (env.NOVA_UNLIMITED_OWNERS ?? '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  for (const id of unlimitedOwners) if (!UUID.test(id)) throw new Error('NOVA_UNLIMITED_OWNERS must be a comma-separated list of uuids');
  return { dailyRunsPerAccount, unlimitedOwners };
}
/** Inside the turn transaction (owner row already locked): counts one run or reports the cap. */
export async function consumeDailyRun(c: PoolClient, owner: string, limits: AccountLimits): Promise<boolean> {
  if (limits.unlimitedOwners.includes(owner.toLowerCase())) return true;
  const used = (await c.query('SELECT runs FROM account_usage WHERE owner_id=$1 AND day=current_date FOR UPDATE', [owner])).rows[0]?.runs ?? 0;
  if (used >= limits.dailyRunsPerAccount) return false;
  await c.query('INSERT INTO account_usage(owner_id,day,runs) VALUES($1,current_date,1) ON CONFLICT(owner_id,day) DO UPDATE SET runs=account_usage.runs+1', [owner]);
  return true;
}
