'use strict'

const api = window.xiaoxiaoyun

const els = {
  titlebar: document.getElementById('titlebar'),
  pageTitle: document.getElementById('pageTitle'),
  stage: document.getElementById('stage'),
  emptyState: document.getElementById('emptyState'),
  btnRefresh: document.getElementById('btnRefresh'),
  btnAutoLogin: document.getElementById('btnAutoLogin'),
  btnSettings: document.getElementById('btnSettings'),
  btnMinimize: document.getElementById('btnMinimize'),
  btnMaximize: document.getElementById('btnMaximize'),
  btnClose: document.getElementById('btnClose'),
  btnOpenSettings: document.getElementById('btnOpenSettings'),
  drawer: document.getElementById('drawer'),
  drawerMask: document.getElementById('drawerMask'),
  btnCloseSettings: document.getElementById('btnCloseSettings'),
  inputSiteUrl: document.getElementById('inputSiteUrl'),
  btnSaveUrl: document.getElementById('btnSaveUrl'),
  toggleAutoLogin: document.getElementById('toggleAutoLogin'),
  accountList: document.getElementById('accountList'),
  emptyAccounts: document.getElementById('emptyAccounts'),
  inputUsername: document.getElementById('inputUsername'),
  inputPassword: document.getElementById('inputPassword'),
  btnAddAccount: document.getElementById('btnAddAccount'),
  btnLoginNow: document.getElementById('btnLoginNow'),
  formError: document.getElementById('formError'),
  storagePath: document.getElementById('storagePath'),
  storageHint: document.getElementById('storageHint'),
  toast: document.getElementById('toast')
}

let state = null
let toastTimer = null

function showToast (message, isError = false) {
  els.toast.textContent = message
  els.toast.classList.toggle('error', isError)
  els.toast.hidden = false
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    els.toast.hidden = true
  }, 2600)
}

function render (next) {
  state = next
  const page = state.page || {}

  els.pageTitle.textContent = page.title || '校校云'
  els.emptyState.hidden = Boolean(state.siteUrl)
  els.btnRefresh.classList.toggle('is-busy', Boolean(page.loading))

  if (document.activeElement !== els.inputSiteUrl) {
    els.inputSiteUrl.value = state.siteUrl || ''
  }
  els.toggleAutoLogin.checked = Boolean(state.autoLogin)

  const storage = state.storage || {}
  els.storagePath.textContent = storage.dataDir || '—'
  els.storageHint.textContent = storage.portable
    ? '便携模式：配置、账号和登录态都在程序目录的 data 文件夹里，重启（含冰点还原）后依然存在。'
    : '未启用便携模式：数据写在系统用户目录，如果电脑有冰点还原，重启后账号会丢失。把程序和目录一起放到非系统盘即可自动切换为便携模式。'
  els.storageHint.classList.toggle('error', !storage.portable)

  els.accountList.innerHTML = ''
  const accounts = state.accounts || []
  els.emptyAccounts.hidden = accounts.length > 0

  for (const account of accounts) {
    const active = account.id === state.activeAccountId
    const li = document.createElement('li')
    li.className = `account-item${active ? ' is-active' : ''}`

    const nameWrap = document.createElement('div')
    nameWrap.className = 'account-name'
    nameWrap.textContent = account.username
    if (active) {
      const badge = document.createElement('span')
      badge.className = 'account-badge'
      badge.textContent = '当前'
      nameWrap.appendChild(badge)
    }
    if (account.usable === false) {
      const badge = document.createElement('span')
      badge.className = 'account-badge warn'
      badge.textContent = '需重新输入'
      badge.title = '这个账号的密码在当前环境解不开（例如换了电脑或换了数据目录），请重新添加'
      nameWrap.appendChild(badge)
    } else if (account.encrypted === false) {
      const badge = document.createElement('span')
      badge.className = 'account-badge'
      badge.textContent = '未加密'
      nameWrap.appendChild(badge)
    }

    const ops = document.createElement('div')
    ops.className = 'account-ops'

    if (!active) {
      const useBtn = document.createElement('button')
      useBtn.textContent = '设为当前'
      useBtn.addEventListener('click', () => run(() => api.setActiveAccount(account.id)))
      ops.appendChild(useBtn)
    }

    const delBtn = document.createElement('button')
    delBtn.className = 'danger'
    delBtn.textContent = '删除'
    delBtn.addEventListener('click', () => {
      if (!confirm(`删除账号「${account.username}」？`)) return
      run(() => api.removeAccount(account.id))
    })
    ops.appendChild(delBtn)

    li.appendChild(nameWrap)
    li.appendChild(ops)
    els.accountList.appendChild(li)
  }
}

async function run (action, successMessage) {
  try {
    const next = await action()
    if (next) render(next)
    if (successMessage) showToast(successMessage)
  } catch (error) {
    showToast(error?.message || String(error), true)
  }
}

function openSettings () {
  els.drawer.hidden = false
  els.drawerMask.hidden = false
  els.formError.hidden = true
  // 原网页视图层级更高，打开抽屉时必须让主进程把它藏起来，否则设置界面会被盖住
  api.setOverlay(true)
  if (!els.inputSiteUrl.value && state?.siteUrl) {
    els.inputSiteUrl.value = state.siteUrl
  }
  els.inputSiteUrl.focus()
}

function closeSettings () {
  els.drawer.hidden = true
  els.drawerMask.hidden = true
  api.setOverlay(false)
}

function bindEvents () {
  els.btnOpenSettings.addEventListener('click', openSettings)
  els.btnSettings.addEventListener('click', () => {
    if (els.drawer.hidden) openSettings()
    else closeSettings()
  })
  els.btnCloseSettings.addEventListener('click', closeSettings)
  els.drawerMask.addEventListener('click', closeSettings)

  els.btnRefresh.addEventListener('click', async () => {
    const ok = await api.reload()
    if (!ok) showToast('请先在设置里填写站点地址', true)
  })

  els.btnAutoLogin.addEventListener('click', async () => {
    await api.loginNow()
    showToast('已执行一次自动登录')
  })

  els.btnSaveUrl.addEventListener('click', async () => {
    if (!els.inputSiteUrl.value.trim()) {
      showToast('请先填写站点地址', true)
      els.inputSiteUrl.focus()
      return
    }
    try {
      render(await api.saveSettings({ siteUrl: els.inputSiteUrl.value }))
      showToast('站点地址已保存')
      closeSettings()
    } catch (error) {
      showToast(error?.message || String(error), true)
    }
  })

  els.inputSiteUrl.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') els.btnSaveUrl.click()
  })

  els.toggleAutoLogin.addEventListener('change', () => {
    run(() => api.saveSettings({ autoLogin: els.toggleAutoLogin.checked }))
  })

  els.btnAddAccount.addEventListener('click', async () => {
    const username = els.inputUsername.value.trim()
    const password = els.inputPassword.value
    if (!username || !password) {
      els.formError.textContent = '账号和密码都不能为空'
      els.formError.hidden = false
      return
    }
    els.formError.hidden = true
    try {
      const next = await api.addAccount({ username, password })
      render(next)
      els.inputUsername.value = ''
      els.inputPassword.value = ''
      showToast('账号已添加')
    } catch (error) {
      els.formError.textContent = error?.message || String(error)
      els.formError.hidden = false
    }
  })

  els.btnLoginNow.addEventListener('click', async () => {
    await api.loginNow()
    showToast('已执行一次自动登录')
  })

  els.btnMinimize.addEventListener('click', () => api.minimize())
  els.btnMaximize.addEventListener('click', () => api.toggleMaximize())
  els.btnClose.addEventListener('click', () => api.close())

  els.titlebar.addEventListener('dblclick', (event) => {
    if (event.target.closest('.actions')) return
    api.toggleMaximize()
  })

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !els.drawer.hidden) closeSettings()
  })
}

async function bootstrap () {
  bindEvents()
  render(await api.getState())
  api.onState((next) => render(next))
  api.onLoginResult((result) => {
    if (result?.ok) showToast('自动登录已提交')
    else if (result?.reason === 'no-login-form') showToast('当前页面没有登录表单', true)
    else if (result?.reason) showToast(`自动登录失败：${result.reason}`, true)
  })

  if (!state.siteUrl) openSettings()
}

bootstrap()
