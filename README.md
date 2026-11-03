# 校校云客户端

基于 Electron 的校校云桌面客户端：**直接加载原网页**，不重写业务界面，只在外层包一层桌面壳——
自定义标题栏、刷新按钮、以及可保存账号密码的「自动登录」。

## 功能（v1）

- 原网页直连：以独立 `WebContentsView` 加载配置的站点地址，CSP / `X-Frame-Options` 不会像 iframe 那样拦住它。
- 无边框标题栏：显示页面标题，支持拖拽移动、双击最大化、最小化 / 最大化 / 关闭。
- 刷新：一键重载当前页面（换地址后自动跳到新地址）。
- 账号自动登录：在设置里添加账号密码，页面加载完成后自动定位登录框、填值并提交。
- 密码安全：使用系统钥匙串（Electron `safeStorage`）加密后存于本机，不落明文、不上传服务器。
- 会话保持：Cookie / 登录态使用 `persist:xiaoxiaoyun` 分区持久化，关掉再开免登录。

## 开发

```bash
npm install        # 安装依赖（首次会下载 Electron，稍慢）
npm start          # 启动客户端
```

首次启动会自动弹出设置面板，填入站点地址即可开始使用。

## 打包

```bash
npm run dist:linux   # AppImage + deb
npm run dist:win     # NSIS 安装包
npm run dist:mac     # dmg
```

产物输出到 `dist/`。

## 目录结构

```
src/
├── main/
│   ├── main.js        # 主进程：窗口、WebContentsView、IPC
│   ├── store.js       # 配置与账号存储（safeStorage 加密）
│   └── autologin.js   # 注入式自动登录脚本（启发式定位登录表单）
├── preload/
│   └── shell-protocol.js  # 渲染进程可用的安全 IPC 桥
└── renderer/
    ├── index.html     # 标题栏 / 空状态 / 设置抽屉
    ├── styles.css
    └── app.js
```

## 自动登录的工作方式

不依赖写死的选择器：脚本会在页面加载后轮询 20 秒，按 `autocomplete=username`、`name/id/placeholder`
里的「账号 / 用户名 / 手机 / 邮箱 / 学号」等线索定位账号框，配合同容器内的 `input[type=password]` 定位密码框；
填值走原生 value setter 并派发 `input`/`change` 事件（兼容 React / Vue 受控组件），再依次尝试
表单提交按钮 → 页面上的「登录」按钮 → `form.requestSubmit()` → 回车。

若站点结构特殊，可在浏览器里确认登录页真实的输入框属性，再调整 `src/main/autologin.js` 中的启发式顺序。

## 安全说明

- 渲染壳开启 `contextIsolation` + `sandbox`，不暴露 Node.js。
- 远程页面与本地壳进程隔离，跳转仅允许 http/https，站外链接交给系统浏览器。
- 权限请求（摄像头 / 麦克风 / 通知等）默认全部拒绝，需要时再按站点白名单放行。

## 许可证

MIT
