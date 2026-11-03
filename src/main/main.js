'use strict'

const path = require('node:path')
const { app, BrowserWindow, WebContentsView, ipcMain, shell, session } = require('electron')
const Store = require('./store')
const { buildAutoLoginScript } = require('./autologin')

const CHROME_HEIGHT = 44
const PARTITION = 'persist:xiaoxiaoyun'

const store = new Store()

let mainWindow = null
let siteView = null
let lastAutoLoginUrl = null

const pageState = {
  title: '校校云',
  loading: false,
  url: ''
}

function publicState () {
  return { ...store.getPublicState(), page: pageState }
}

function pushState () {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('state:update', publicState())
  }
}

function normalizeUrl (input) {
  const value = String(input || '').trim()
  if (!value) return ''
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value)) return value
  return `https://${value}`
}

function applySiteUrl () {
  if (!siteView) return
  const url = normalizeUrl(store.getState().siteUrl)
  pageState.url = url
  if (!url) {
    siteView.setVisible(false)
    pushState()
    return
  }
  siteView.setVisible(true)
  const current = siteView.webContents.getURL()
  if (current !== url) {
    siteView.webContents.loadURL(url).catch(() => {})
  }
  pushState()
}

function layout () {
  if (!mainWindow || !siteView) return
  const bounds = mainWindow.getContentBounds()
  siteView.setBounds({
    x: 0,
    y: CHROME_HEIGHT,
    width: Math.max(0, bounds.width),
    height: Math.max(0, bounds.height - CHROME_HEIGHT)
  })
}

async function runAutoLogin () {
  const state = store.getState()
  if (!state.autoLogin) return
  const credential = store.getActiveCredential()
  if (!credential || !credential.username || !credential.password) return

  const url = siteView.webContents.getURL()
  if (!url || url === 'about:blank') return
  if (lastAutoLoginUrl === url) return
  lastAutoLoginUrl = url

  try {
    const result = await siteView.webContents.executeJavaScript(
      buildAutoLoginScript(credential),
      true
    )
    if (result && result.ok) {
      mainWindow?.webContents.send('login:result', { ok: true, method: result.method })
    }
  } catch (error) {
    mainWindow?.webContents.send('login:result', { ok: false, reason: error.message })
  }
}

function createSiteView () {
  siteView = new WebContentsView({
    webPreferences: {
      partition: PARTITION,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  })

  mainWindow.contentView.addChildView(siteView)
  layout()

  const contents = siteView.webContents
  registerRefreshShortcut(contents)

  // 去掉 Electron 标识，避免原站点把它当成受限客户端
  contents.setUserAgent(
    contents.getUserAgent().replace(/Electron\/[\d.]+ /g, '').replace(/\sxiaoxiaoyunclient\/[\d.]+/g, '')
  )

  contents.on('page-title-updated', (_event, title) => {
    pageState.title = title || '校校云'
    pushState()
  })

  contents.on('did-start-loading', () => {
    pageState.loading = true
    pushState()
  })

  contents.on('did-stop-loading', () => {
    pageState.loading = false
    pageState.url = contents.getURL()
    pushState()
  })

  contents.on('did-navigate', (_event, url) => {
    pageState.url = url
    pushState()
  })

  contents.on('did-finish-load', () => {
    runAutoLogin()
  })

  // 新窗口：同源页面在当前视图内打开，站外链接交给系统浏览器
  contents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      try {
        const target = new URL(url)
        const base = new URL(contents.getURL())
        if (target.host === base.host) {
          contents.loadURL(url)
          return { action: 'deny' }
        }
      } catch {}
      shell.openExternal(url)
    }
    return { action: 'deny' }
  })

  contents.on('will-navigate', (event, url) => {
    if (!url.startsWith('http')) event.preventDefault()
  })
}

function createMainWindow () {
  const { windowBounds, windowMaximized } = store.getState()

  mainWindow = new BrowserWindow({
    width: windowBounds.width,
    height: windowBounds.height,
    x: windowBounds.x,
    y: windowBounds.y,
    minWidth: 880,
    minHeight: 560,
    frame: false,
    show: false,
    backgroundColor: '#101418',
    title: '校校云',
    icon: path.join(__dirname, '..', 'assets', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'shell-protocol.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'))
  registerRefreshShortcut(mainWindow.webContents)

  mainWindow.once('ready-to-show', () => {
    if (windowMaximized) mainWindow.maximize()
    mainWindow.show()
  })

  mainWindow.on('resize', () => {
    layout()
  })

  mainWindow.on('maximize', () => {
    pushState()
    saveWindowState()
  })

  mainWindow.on('unmaximize', () => {
    pushState()
    saveWindowState()
  })

  mainWindow.on('close', () => {
    saveWindowState()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
    siteView = null
  })

  createSiteView()
  applySiteUrl()
}

function saveWindowState () {
  if (!mainWindow || mainWindow.isDestroyed()) return
  const maximized = mainWindow.isMaximized()
  store.saveWindowState({
    bounds: maximized ? undefined : mainWindow.getBounds(),
    maximized
  })
}

app.setAppUserModelId('com.xiaoxiaoyun.client')

/** F5 / Ctrl+R 刷新：壳页面和原网页都生效 */
function registerRefreshShortcut (contents) {
  contents.on('before-input-event', (event, input) => {
    const isRefresh = input.type === 'keyDown' && (
      input.key === 'F5' || ((input.control || input.meta) && input.key.toLowerCase() === 'r')
    )
    if (!isRefresh || !siteView) return
    event.preventDefault()
    lastAutoLoginUrl = null
    siteView.webContents.reload()
  })
}

app.whenReady().then(() => {
  session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })

  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

/* ------------------------------ IPC ------------------------------ */

ipcMain.handle('state:get', () => publicState())

ipcMain.handle('settings:save', (_event, payload) => {
  store.updateSettings(payload || {})
  lastAutoLoginUrl = null
  applySiteUrl()
  pushState()
  return publicState()
})

ipcMain.handle('account:add', (_event, payload) => {
  const username = String(payload?.username || '').trim()
  const password = String(payload?.password || '')
  if (!username || !password) {
    throw new Error('账号和密码都不能为空')
  }
  lastAutoLoginUrl = null
  store.addAccount({ username, password })
  pushState()
  return publicState()
})

ipcMain.handle('account:update', (_event, id, payload) => {
  lastAutoLoginUrl = null
  store.updateAccount(id, payload || {})
  pushState()
  return publicState()
})

ipcMain.handle('account:remove', (_event, id) => {
  lastAutoLoginUrl = null
  store.removeAccount(id)
  pushState()
  return publicState()
})

ipcMain.handle('account:setActive', (_event, id) => {
  lastAutoLoginUrl = null
  store.setActiveAccount(id)
  pushState()
  return publicState()
})

ipcMain.handle('view:reload', () => {
  if (!siteView) return false
  const url = normalizeUrl(store.getState().siteUrl)
  if (!url) return false
  lastAutoLoginUrl = null
  if (siteView.webContents.getURL() === url) {
    siteView.webContents.reload()
  } else {
    siteView.webContents.loadURL(url).catch(() => {})
  }
  return true
})

ipcMain.handle('view:login-now', async () => {
  lastAutoLoginUrl = null
  await runAutoLogin()
  return true
})

ipcMain.handle('window:minimize', () => {
  mainWindow?.minimize()
})

ipcMain.handle('window:toggle-maximize', () => {
  if (!mainWindow) return false
  if (mainWindow.isMaximized()) mainWindow.unmaximize()
  else mainWindow.maximize()
  return mainWindow.isMaximized()
})

ipcMain.handle('window:close', () => {
  mainWindow?.close()
})
