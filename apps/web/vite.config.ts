import react from '@vitejs/plugin-react'
import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'
import { readFile, rename, unlink, writeFile } from 'fs/promises'
import type { IncomingMessage, ServerResponse } from 'http'
import { resolve } from 'path'
import { defineConfig, type Plugin, type ViteDevServer } from 'vite'

const LOCALHOST_RE = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/
const ALLOWED_REMOTE_ADDR = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])

const VAULT_PATH = resolve(__dirname, '../../vault-data.json')
const MAX_BODY_BYTES = 1024 * 1024 // 1 MB limit

const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1 }
const SALT_BYTES = 16
const IV_BYTES = 12
const KEY_BYTES = 32

interface EncryptedVaultEnvelope {
  version: 1
  encrypted: true
  kdf: 'scrypt'
  kdfParams: { N: number; r: number; p: number; dkLen: number }
  cipher: 'aes-256-gcm'
  salt: string
  iv: string
  tag: string
  ciphertext: string
}

function isEncryptedEnvelope(value: unknown): value is EncryptedVaultEnvelope {
  if (!value || typeof value !== 'object') return false
  const obj = value as Record<string, unknown>
  return (
    obj.encrypted === true &&
    obj.cipher === 'aes-256-gcm' &&
    typeof obj.salt === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.tag === 'string' &&
    typeof obj.ciphertext === 'string'
  )
}

function getPassphrase(req: IncomingMessage): string | null {
  const raw = req.headers['x-vault-passphrase']
  const value = Array.isArray(raw) ? raw[0] : raw
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}

function encryptVaultData(data: unknown, passphrase: string): EncryptedVaultEnvelope {
  const salt = randomBytes(SALT_BYTES)
  const key = scryptSync(passphrase, salt, KEY_BYTES, SCRYPT_PARAMS)
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = JSON.stringify(data)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf-8'), cipher.final()])
  const tag = cipher.getAuthTag()
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
  }
}

function decryptVaultData(envelope: EncryptedVaultEnvelope, passphrase: string): unknown {
  const salt = Buffer.from(envelope.salt, 'base64')
  const iv = Buffer.from(envelope.iv, 'base64')
  const tag = Buffer.from(envelope.tag, 'base64')
  const ciphertext = Buffer.from(envelope.ciphertext, 'base64')
  const params = envelope.kdfParams || { ...SCRYPT_PARAMS, dkLen: KEY_BYTES }
  const key = scryptSync(passphrase, salt, params.dkLen || KEY_BYTES, params)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
  return JSON.parse(plaintext)
}

function isAllowedOrigin(origin: string) {
  return LOCALHOST_RE.test(origin)
}

function json(res: ServerResponse, statusCode: number, body: unknown) {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

// Custom plugin to serve vault data as a live API (dev only)
function vaultApiPlugin(): Plugin {
  return {
    name: 'vault-api',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/api/vault', async (req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Vary', 'Origin')
        res.setHeader('X-Content-Type-Options', 'nosniff')

        // Defense-in-depth: refuse non-loopback requests. This prevents LAN access + CSRF primitives.
        const remoteAddress = req.socket.remoteAddress ?? ''
        if (!ALLOWED_REMOTE_ADDR.has(remoteAddress)) {
          json(res, 403, { error: 'Forbidden' })
          return
        }

        // CORS — strict localhost-only origin check
        const origin = typeof req.headers.origin === 'string' ? req.headers.origin : undefined
        if (origin && isAllowedOrigin(origin)) {
          res.setHeader('Access-Control-Allow-Origin', origin)
        }
        res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS')
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Vault-Passphrase, X-Vault-Force-Create')

        // Preflight
        if (req.method === 'OPTIONS') {
          if (origin && !isAllowedOrigin(origin)) {
            json(res, 403, { error: 'Forbidden' })
            return
          }
          res.statusCode = 204
          res.end()
          return
        }

        if (req.method === 'GET') {
          try {
            const data = await readFile(VAULT_PATH, 'utf-8')
            const parsed = JSON.parse(data)

            if (isEncryptedEnvelope(parsed)) {
              const passphrase = getPassphrase(req)
              if (!passphrase) {
                json(res, 401, { error: 'Vault locked. Passphrase required.', locked: true })
                return
              }
              try {
                const decrypted = decryptVaultData(parsed, passphrase)
                res.setHeader('Content-Type', 'application/json')
                res.end(JSON.stringify(decrypted))
              } catch {
                json(res, 401, { error: 'Invalid passphrase.', locked: true })
              }
              return
            }

            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify(parsed))
          } catch {
            json(res, 404, { error: 'Vault not found' })
          }
          return
        }

        if (req.method === 'PUT' || req.method === 'POST') {
          // Require an allowed Origin for any browser-initiated mutating request (CSRF defense).
          if (!origin || !isAllowedOrigin(origin)) {
            json(res, 403, { error: 'Forbidden' })
            return
          }

          // Enforce Content-Type
          const ct = req.headers['content-type'] || ''
          if (typeof ct !== 'string' || !ct.includes('application/json')) {
            json(res, 415, { error: 'Content-Type must be application/json' })
            return
          }

          // Collect body with size limit
          const chunks: Buffer[] = []
          let totalSize = 0

          try {
            for await (const chunk of req) {
              totalSize += chunk.length
              if (totalSize > MAX_BODY_BYTES) {
                json(res, 413, { error: 'Request body too large (max 1MB)' })
                req.destroy()
                return
              }
              chunks.push(chunk)
            }
          } catch {
            json(res, 400, { error: 'Failed to read request body' })
            return
          }

          const body = Buffer.concat(chunks).toString('utf-8')

          try {
            const parsed = JSON.parse(body)
            const passphrase = getPassphrase(req)

            // Check existing vault encryption status
            let existingEncrypted = false
            let existingEnvelope: EncryptedVaultEnvelope | null = null
            let noExistingVault = false
            try {
              const existingRaw = await readFile(VAULT_PATH, 'utf-8')
              const existingParsed = JSON.parse(existingRaw)
              if (isEncryptedEnvelope(existingParsed)) {
                existingEncrypted = true
                existingEnvelope = existingParsed
              }
            } catch {
              noExistingVault = true
            }

            // X-Vault-Force-Create: only allowed when no vault file exists.
            // Prevents overwriting an encrypted vault without verifying the old passphrase.
            const forceCreate = req.headers['x-vault-force-create'] === '1'

            if (forceCreate && !noExistingVault && existingEncrypted) {
              json(res, 409, { error: 'An encrypted vault already exists. Unlock it with your passphrase first.' })
              return
            }

            if (existingEncrypted && !forceCreate) {
              if (!passphrase) {
                json(res, 401, { error: 'Vault locked. Passphrase required.', locked: true })
                return
              }
              try {
                decryptVaultData(existingEnvelope!, passphrase)
              } catch {
                json(res, 401, { error: 'Invalid passphrase.', locked: true })
                return
              }
            }

            const shouldEncrypt = existingEncrypted || !!passphrase
            if (shouldEncrypt && !passphrase) {
              json(res, 401, { error: 'Vault locked. Passphrase required.', locked: true })
              return
            }

            const payload = shouldEncrypt ? encryptVaultData(parsed, passphrase!) : parsed

            // Atomic write: write to temp, then rename
            const tmpPath = VAULT_PATH + '.tmp.' + randomUUID().slice(0, 8)
            try {
              await writeFile(tmpPath, JSON.stringify(payload, null, 2), 'utf-8')
              await rename(tmpPath, VAULT_PATH)
            } catch (writeErr: unknown) {
              // Clean up orphaned temp file
              await unlink(tmpPath).catch(() => {})
              const msg = writeErr instanceof Error ? writeErr.message : 'Unknown error'
              json(res, 500, { error: `Failed to write vault: ${msg}` })
              return
            }

            json(res, 200, { ok: true })
          } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : 'Invalid JSON'
            json(res, 400, { error: msg })
          }
          return
        }

        json(res, 405, { error: 'Method not allowed' })
      })
    },
  }
}

export default defineConfig({
  worker: { format: 'es' },
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  preview: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  plugins: [react(), vaultApiPlugin()],
})
