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

/**
 * 本地配置与账号存储。
 * 密码统一走系统级加密（Electron safeStorage），落盘时不保存明文。
 */
class Store {
  constructor () {
    this.file = path.join(app.getPath('userData'), 'settings.json')
    this.state = this.load()
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
  getPublicState () {
    return {
      siteUrl: this.state.siteUrl,
      autoLogin: this.state.autoLogin,
      activeAccountId: this.state.activeAccountId,
      accounts: this.state.accounts.map(({ id, username, createdAt, encrypted }) => ({
        id,
        username,
        createdAt,
        encrypted
      }))
    }
  }

  /** 密码加密，safeStorage 不可用时退化为明文并标记 */
  encryptSecret (plain) {
    if (safeStorage.isEncryptionAvailable()) {
      return { secret: safeStorage.encryptString(plain).toString('base64'), encrypted: true }
    }
    return { secret: Buffer.from(plain, 'utf8').toString('base64'), encrypted: false }
  }

  decryptSecret (account) {
    if (!account || !account.secret) return ''
    if (account.encrypted) {
      return safeStorage.decryptString(Buffer.from(account.secret, 'base64'))
    }
    return Buffer.from(account.secret, 'base64').toString('utf8')
  }

  updateSettings ({ siteUrl, autoLogin }) {
    if (typeof siteUrl === 'string') {
      this.state.siteUrl = siteUrl.trim()
    }
    if (typeof autoLogin === 'boolean') {
      this.state.autoLogin = autoLogin
    }
    this.persist()
    return this.getPublicState()
  }

  addAccount ({ username, password }) {
    const { secret, encrypted } = this.encryptSecret(password)
    const account = {
      id: crypto.randomUUID(),
      username,
      secret,
      encrypted,
      createdAt: new Date().toISOString()
    }
    this.state.accounts.push(account)
    if (!this.state.activeAccountId) {
      this.state.activeAccountId = account.id
    }
    this.persist()
    return this.getPublicState()
  }

  updateAccount (id, { username, password }) {
    const account = this.state.accounts.find((item) => item.id === id)
    if (!account) return this.getPublicState()
    if (typeof username === 'string' && username.trim()) {
      account.username = username.trim()
    }
    if (typeof password === 'string' && password) {
      const { secret, encrypted } = this.encryptSecret(password)
      account.secret = secret
      account.encrypted = encrypted
    }
    this.persist()
    return this.getPublicState()
  }

  removeAccount (id) {
    this.state.accounts = this.state.accounts.filter((item) => item.id !== id)
    if (this.state.activeAccountId === id) {
      this.state.activeAccountId = this.state.accounts[0]?.id ?? null
    }
    this.persist()
    return this.getPublicState()
  }

  setActiveAccount (id) {
    if (this.state.accounts.some((item) => item.id === id)) {
      this.state.activeAccountId = id
    }
    this.persist()
    return this.getPublicState()
  }

  /** 取当前生效账号（用户名 + 解密后的密码） */
  getActiveCredential () {
    const account = this.state.accounts.find((item) => item.id === this.state.activeAccountId)
    if (!account) return null
    try {
      return { username: account.username, password: this.decryptSecret(account) }
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
