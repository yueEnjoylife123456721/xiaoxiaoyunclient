'use strict'

const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const { app, safeStorage } = require('electron')

const DEFAULT_STATE = {
  siteUrl: '',
  autoLogin: true,
  windowBounds: { width: 1180, height: 820 },
  windowMaximized: false,
  accounts: [],
  activeAccountId: null
}

const CIPHER_SAFE = 'safe-storage'
const CIPHER_AES = 'aes-gcm-local'

/** 便携模式用的本地密钥上下文：只要程序与 data 目录一起搬，密码就能继续解开 */
function deriveLocalKey () {
  return crypto.scryptSync('xiaoxiaoyunclient:v1:portable', 'xxy-portable-salt-v1', 32)
}

function aesEncrypt (plain) {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveLocalKey(), iv)
  const body = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')
}

function aesDecrypt (payload) {
  const raw = Buffer.from(payload, 'base64')
  const iv = raw.subarray(0, 12)
  const tag = raw.subarray(12, 28)
  const body = raw.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveLocalKey(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
}

/**
 * 本地配置与账号存储。
 *
 * 加密策略：
 * - 便携模式（学校冰点还原场景）：AES-256-GCM + 程序内置密钥。
 *   safeStorage 在 Windows 下用 DPAPI，密钥落在用户配置目录里，重启被还原后旧密码就解不开了。
 * - 普通模式：优先 Electron safeStorage（系统钥匙串），不可用时退回 AES。
 * AES 内置密钥只能挡住「直接打开文件看到明文」，挡不住逆向，别当真正的机密保管。
 */
class Store {
  constructor ({ portable = false } = {}) {
    this.portable = portable
    this.file = path.join(app.getPath('userData'), 'settings.json')
    this.state = this.load()
  }

  cipherMode () {
    if (this.portable) return CIPHER_AES
    return safeStorage.isEncryptionAvailable() ? CIPHER_SAFE : CIPHER_AES
  }

  load () {
    try {
      const raw = fs.readFileSync(this.file, 'utf8')
      const parsed = JSON.parse(raw)
      return { ...DEFAULT_STATE, ...parsed }
    } catch {
      return { ...DEFAULT_STATE }
    }
  }

  persist () {
    const dir = path.dirname(this.file)
    fs.mkdirSync(dir, { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2), 'utf8')
    fs.renameSync(tmp, this.file)
  }

  getState () {
    return this.state
  }

  /** 供渲染进程使用的安全视图（不含密码） */
  async getPublicState () {
    return {
      siteUrl: this.state.siteUrl,
      autoLogin: this.state.autoLogin,
      activeAccountId: this.state.activeAccountId,
      accounts: await Promise.all(this.state.accounts.map(async (account) => {
        let usable = true
        try {
          usable = Boolean(await this.decryptSecret(account))
        } catch {
          // 例如用 safeStorage 加密的旧账号被搬到便携目录，DPAPI 密钥已对不上
          usable = false
        }
        return {
          id: account.id,
          username: account.username,
          createdAt: account.createdAt,
          encrypted: account.encrypted !== false,
          cipher: account.cipher || (account.encrypted ? CIPHER_SAFE : 'base64'),
          usable
        }
      }))
    }
  }

  async encryptSecret (plain) {
    if (this.cipherMode() === CIPHER_AES) {
      return { secret: aesEncrypt(plain), encrypted: true, cipher: CIPHER_AES }
    }
    const encrypted = await safeStorage.encryptStringAsync(plain)
    return { secret: encrypted.toString('base64'), encrypted: true, cipher: CIPHER_SAFE }
  }

  async decryptSecret (account) {
    if (!account || !account.secret) return ''
    const cipher = account.cipher || (account.encrypted ? CIPHER_SAFE : null)
    if (cipher === CIPHER_AES) return aesDecrypt(account.secret)
    if (cipher === CIPHER_SAFE) {
      return safeStorage.decryptStringAsync(Buffer.from(account.secret, 'base64'))
    }
    return Buffer.from(account.secret, 'base64').toString('utf8')
  }

  async updateSettings ({ siteUrl, autoLogin }) {
    if (typeof siteUrl === 'string') {
      this.state.siteUrl = siteUrl.trim()
    }
    if (typeof autoLogin === 'boolean') {
      this.state.autoLogin = autoLogin
    }
    this.persist()
    return this.getPublicState()
  }

  async addAccount ({ username, password }) {
    const { secret, encrypted, cipher } = await this.encryptSecret(password)
    const account = {
      id: crypto.randomUUID(),
      username,
      secret,
      encrypted,
      cipher,
      createdAt: new Date().toISOString()
    }
    this.state.accounts.push(account)
    if (!this.state.activeAccountId) {
      this.state.activeAccountId = account.id
    }
    this.persist()
    return this.getPublicState()
  }

  async updateAccount (id, { username, password }) {
    const account = this.state.accounts.find((item) => item.id === id)
    if (!account) return this.getPublicState()
    if (typeof username === 'string' && username.trim()) {
      account.username = username.trim()
    }
    if (typeof password === 'string' && password) {
      const { secret, encrypted, cipher } = await this.encryptSecret(password)
      account.secret = secret
      account.encrypted = encrypted
      account.cipher = cipher
    }
    this.persist()
    return this.getPublicState()
  }

  async removeAccount (id) {
    this.state.accounts = this.state.accounts.filter((item) => item.id !== id)
    if (this.state.activeAccountId === id) {
      this.state.activeAccountId = this.state.accounts[0]?.id ?? null
    }
    this.persist()
    return this.getPublicState()
  }

  async setActiveAccount (id) {
    if (this.state.accounts.some((item) => item.id === id)) {
      this.state.activeAccountId = id
    }
    this.persist()
    return this.getPublicState()
  }

  /** 取当前生效账号（用户名 + 解密后的密码） */
  async getActiveCredential () {
    const account = this.state.accounts.find((item) => item.id === this.state.activeAccountId)
    if (!account) return null
    try {
      return { username: account.username, password: await this.decryptSecret(account) }
    } catch {
      return null
    }
  }

  saveWindowState ({ bounds, maximized }) {
    if (bounds) {
      this.state.windowBounds = {
        width: Math.max(880, Math.round(bounds.width)),
        height: Math.max(560, Math.round(bounds.height)),
        x: bounds.x,
        y: bounds.y
      }
    }
    if (typeof maximized === 'boolean') {
      this.state.windowMaximized = maximized
    }
    this.persist()
  }
}

module.exports = Store
