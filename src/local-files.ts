import { constants } from 'node:fs';
import { open, lstat, realpath, unlink } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Local single-host development adapter. Not S3, not a secret manager.
export class LocalFiles {
  private key!: Buffer;
  constructor(readonly root: string) {}
  async init(allowCreate = true) {
    const stat = await lstat(this.root);
    if (!stat.isDirectory() || stat.isSymbolicLink() || (stat.mode & 0o777) !== 0o700 || stat.uid !== process.getuid!() || await realpath(this.root) !== resolve(this.root)) throw new Error('Unsafe private storage root');
    const path = join(this.root, '.key');
    if (allowCreate) {
      const f = await open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try { await f.writeFile(randomBytes(32)); await f.sync(); } finally { await f.close(); }
      await this.sync();
    }
    const f = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const s = await f.stat();
      if (!s.isFile() || s.size !== 32 || (s.mode & 0o777) !== 0o600 || s.uid !== process.getuid!()) throw new Error('Unsafe key');
      this.key = await f.readFile();
    } finally { await f.close(); }
  }
  fingerprint() { return createHash('sha256').update(this.key).digest('hex'); }
  path(id: string) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('Invalid storage ID');
    return join(this.root, id);
  }
  async sync() { const f = await open(this.root, constants.O_RDONLY | constants.O_DIRECTORY); try { await f.sync(); } finally { await f.close(); } }
  async put(owner: string, id: string, bytes: Buffer) {
    const nonce = randomBytes(12), cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(owner + ':' + id));
    const encrypted = Buffer.concat([cipher.update(bytes), cipher.final()]);
    const f = await open(this.path(id), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    try { await f.writeFile(Buffer.concat([nonce, cipher.getAuthTag(), encrypted])); await f.sync(); } finally { await f.close(); }
    await this.sync();
  }
  async remove(id: string) {
    try { await unlink(this.path(id)); } catch (e: any) { if (e.code !== 'ENOENT') throw e; }
    await this.sync();
  }
  async get(owner: string, id: string, size: number, hash: string) {
    const f = await open(this.path(id), constants.O_RDONLY | constants.O_NOFOLLOW);
    let blob: Buffer;
    try { const s = await f.stat(); if (!s.isFile() || s.size !== size + 28 || s.size > 4194332) throw new Error('Corrupt blob'); blob = await f.readFile(); } finally { await f.close(); }
    const decipher = createDecipheriv('aes-256-gcm', this.key, blob.subarray(0, 12));
    decipher.setAAD(Buffer.from(owner + ':' + id)); decipher.setAuthTag(blob.subarray(12, 28));
    const bytes = Buffer.concat([decipher.update(blob.subarray(28)), decipher.final()]);
    if (bytes.length !== size || createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error('Corrupt blob');
    return bytes;
  }
}
