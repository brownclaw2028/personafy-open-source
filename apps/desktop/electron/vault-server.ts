import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  randomUUID,
  scrypt,
} from 'crypto';
import express, { Request, Response, Router } from 'express';
import { readFile, rename, unlink, writeFile } from 'fs/promises';
import { createServer, Server } from 'http';
import { join } from 'path';

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB limit

const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 };
const SALT_BYTES = 16;
const IV_BYTES = 12;
const KEY_BYTES = 32;

// Type guard logic is canonical in apps/web/src/lib/vault-crypto-types.ts.
// Duplicated here because the desktop package cannot import from the web app.
interface EncryptedVaultEnvelope {
  version: 1;
  encrypted: true;
  kdf: 'scrypt';
  kdfParams: { N: number; r: number; p: number; dkLen: number };
  cipher: 'aes-256-gcm';
  salt: string;
  iv: string;
  tag: string;
  ciphertext: string;
}

function isEncryptedEnvelope(value: unknown): value is EncryptedVaultEnvelope {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  return (
    obj.encrypted === true &&
    obj.cipher === 'aes-256-gcm' &&
    typeof obj.salt === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.tag === 'string' &&
    typeof obj.ciphertext === 'string'
  );
}

function getPassphrase(req: Request): string | null {
  const raw = req.headers['x-vault-passphrase'];
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function deriveScryptKey(
  passphrase: string,
  salt: Buffer,
  keyLen: number,
  params: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(passphrase, salt, keyLen, params, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

async function encryptVaultData(
  data: unknown,
  passphrase: string
): Promise<EncryptedVaultEnvelope> {
  const salt = randomBytes(SALT_BYTES);
  const key = await deriveScryptKey(passphrase, salt, KEY_BYTES, SCRYPT_PARAMS);
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const plaintext = JSON.stringify(data);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf-8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return {
    version: 1,
    encrypted: true,
    kdf: 'scrypt',
    kdfParams: { ...SCRYPT_PARAMS, dkLen: KEY_BYTES },
    cipher: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
}

async function decryptVaultData(
  envelope: EncryptedVaultEnvelope,
  passphrase: string
): Promise<unknown> {
  const params = envelope.kdfParams || { ...SCRYPT_PARAMS, dkLen: KEY_BYTES };
  if (
    typeof params.N !== 'number' || params.N < 16384 || params.N > 1_048_576 ||
    typeof params.r !== 'number' || params.r < 1 || params.r > 16 ||
    typeof params.p !== 'number' || params.p < 1 || params.p > 4 ||
    params.dkLen !== KEY_BYTES
  ) {
    throw new Error('Rejected envelope: invalid scrypt parameters.');
  }
  const salt = Buffer.from(envelope.salt, 'base64');
  const iv = Buffer.from(envelope.iv, 'base64');
  const tag = Buffer.from(envelope.tag, 'base64');
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64');
  const key = await deriveScryptKey(passphrase, salt, params.dkLen || KEY_BYTES, params);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString('utf-8');
  return JSON.parse(plaintext);
}

function createVaultRouter(vaultPath: string): Router {
  const router = Router();

  router.use(express.json({ limit: '1mb' }));

  router.get('/', async (req: Request, res: Response) => {
    try {
      const data = await readFile(vaultPath, 'utf-8');
      const parsed = JSON.parse(data);

      if (isEncryptedEnvelope(parsed)) {
        const passphrase = getPassphrase(req);
        if (!passphrase) {
          res.status(401).json({ error: 'Vault locked. Passphrase required.', locked: true });
          return;
        }
        try {
          const decrypted = await decryptVaultData(parsed, passphrase);
          res.json(decrypted);
        } catch {
          res.status(401).json({ error: 'Invalid passphrase.', locked: true });
        }
        return;
      }

      res.json(parsed);
    } catch {
      res.status(404).json({ error: 'Vault not found' });
    }
  });

  router.put('/', handleWrite);
  router.post('/', handleWrite);

  async function handleWrite(req: Request, res: Response) {
    const ct = req.headers['content-type'] || '';
    if (typeof ct !== 'string' || !ct.includes('application/json')) {
      res.status(415).json({ error: 'Content-Type must be application/json' });
      return;
    }

    try {
      const parsed = req.body;
      const passphrase = getPassphrase(req);

      // Check existing vault encryption status
      let existingEncrypted = false;
      let existingEnvelope: EncryptedVaultEnvelope | null = null;
      try {
        const existingRaw = await readFile(vaultPath, 'utf-8');
        const existingParsed = JSON.parse(existingRaw);
        if (isEncryptedEnvelope(existingParsed)) {
          existingEncrypted = true;
          existingEnvelope = existingParsed;
        }
      } catch {
        // no existing vault
      }

      // x-vault-force-create: used during initial vault creation to skip existing-vault auth check
      const forceCreate = req.headers['x-vault-force-create'] === '1';

      if (existingEncrypted && !forceCreate) {
        if (!passphrase) {
          res.status(401).json({ error: 'Vault locked. Passphrase required.', locked: true });
          return;
        }
        try {
          await decryptVaultData(existingEnvelope!, passphrase);
        } catch {
          res.status(401).json({ error: 'Invalid passphrase.', locked: true });
          return;
        }
      }

      const shouldEncrypt = existingEncrypted || !!passphrase;
      if (shouldEncrypt && !passphrase) {
        res.status(401).json({ error: 'Vault locked. Passphrase required.', locked: true });
        return;
      }

      const payload = shouldEncrypt
        ? await encryptVaultData(parsed, passphrase!)
        : parsed;

      // Atomic write: write to temp, then rename
      const tmpPath = vaultPath + '.tmp.' + randomUUID().slice(0, 8);
      try {
        await writeFile(tmpPath, JSON.stringify(payload, null, 2), 'utf-8');
        await rename(tmpPath, vaultPath);
      } catch (writeErr: unknown) {
        await unlink(tmpPath).catch(() => {});
        const msg =
          writeErr instanceof Error ? writeErr.message : 'Unknown error';
        console.error('Failed to write vault:', msg);
        res.status(500).json({ error: 'Failed to write vault' });
        return;
      }

      res.json({ ok: true });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Invalid JSON';
      res.status(400).json({ error: msg });
    }
  }

  router.options('/', (_req: Request, res: Response) => {
    res.sendStatus(204);
  });

  router.all('/', (_req: Request, res: Response) => {
    res.status(405).json({ error: 'Method not allowed' });
  });

  return router;
}

export interface VaultServerInfo {
  port: number;
  server: Server;
  close: () => Promise<void>;
}

const LOCALHOST_ORIGIN_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export async function startVaultServer(
  vaultPath: string,
  webDistPath: string
): Promise<VaultServerInfo> {
  const app = express();

  // CORS: only allow localhost origins
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      if (!LOCALHOST_ORIGIN_RE.test(origin)) {
        res.status(403).json({ error: 'Forbidden: invalid origin' });
        return;
      }
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-vault-passphrase, x-vault-force-create');
      if (req.method === 'OPTIONS') {
        res.sendStatus(204);
        return;
      }
    }
    next();
  });

  // Vault API
  app.use('/api/vault', createVaultRouter(vaultPath));

  // Serve the built SPA
  app.use(express.static(webDistPath));

  // SPA fallback — serve index.html for all non-API, non-file routes
  app.get('*', (_req, res) => {
    res.sendFile(join(webDistPath, 'index.html'));
  });

  const server = createServer(app);

  return new Promise((resolve, reject) => {
    // Port 0 = OS picks a random available port
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      resolve({
        port: addr.port,
        server,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });

    server.on('error', reject);
  });
}
