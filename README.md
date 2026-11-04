# 校校云客户端

基于 Electron 的校校云桌面客户端：**直接加载原网页**，不重写业务界面，只在外层包一层桌面壳——
自定义标题栏、刷新按钮、以及可保存账号密码的「自动登录」。

## 功能（v1）

- 原网页直连：以独立 `WebContentsView` 加载配置的站点地址，CSP / `X-Frame-Options` 不会像 iframe 那样拦住它。
- 无边框标题栏：显示页面标题，支持拖拽移动、双击最大化、最小化 / 最大化 / 关闭。
- 刷新：一键重载当前页面（换地址后自动跳到新地址）。
- 账号自动登录：在设置里添加账号密码，页面加载完成后自动定位登录框、填值并提交。
- 密码安全：便携模式用 AES-256-GCM 加密、普通模式用系统钥匙串（`safeStorage`），落盘均不含明文。
- 便携数据：默认把配置与登录态放在程序目录的 `data/` 下，系统盘被冰点还原也不会丢账号。
- 会话保持：Cookie / 登录态使用 `persist:xiaoxiaoyun` 分区持久化，关掉再开免登录。

## 开发

```bash
npm install        # 安装依赖（首次会下载 Electron，稍慢）
npm start          # 启动客户端
```

首次启动会自动弹出设置面板，填入站点地址即可开始使用。

## 便携模式（学校电脑有冰点还原时必看）

客户端默认**便携模式**：数据不写 `%APPDATA%`，而是写到程序所在目录的 `data/` 文件夹里。

```
D:\校校云\
├─ xiaoxiaoyunclient-v1.0.0-x64.exe   （或解压出来的程序目录）
└─ data\
   ├─ settings.json      站点地址、自动登录开关、账号
   ├─ Cookies / Cache    WebContentsView 的登录态
   └─ ...                Chromium 会话数据
```

- 往 `C:\Program Files` 安装会被 UAC 拦住写权限，此时自动退化回用户目录（设置面板里的「数据位置」会标红提示）。
- 冰点还原只还原系统盘，所以把程序放到 **D 盘、U 盘或任何非还原盘** 即可，`data/` 与程序同生共死。
- 想彻底避开安装步骤，用 `zip` 或 portable 版本解压即用：

| 产物 | 用途 |
|---|---|
| `xiaoxiaoyunclient-v1.0.0-setup.exe` | 常规安装（装到系统盘，会被冰点还原清掉，不推荐在学校用） |
| `xiaoxiaoyunclient-v1.0.0-portable.exe` | 单文件便携版，数据写在 exe 旁边的 `data/` |
| `xiaoxiaoyunclient-v1.0.0-x64.zip` | 绿色免安装，解压到非还原盘直接用 |

### 密码存在哪、有多安全

| 模式 | 加密方式 | 说明 |
|---|---|---|
| 便携模式 | AES-256-GCM + 程序内置密钥 | 配置和程序一起搬走也能解密；**挡不住逆向程序拿到密钥** |
| 普通模式 | Electron `safeStorage`（Windows 用 DPAPI） | 与当前 Windows 用户绑定，重启被还原后旧密码解不开 |

之所以便携模式不沿用 `safeStorage`：它的密钥存在用户配置目录里，冰点还原一重启就没了，密码会变成解不开的死数据。便携模式内置密钥换来的是「重启后账号还在」。设置面板里如果某个账号显示「需重新输入」，就是这个原因。

## 打包

```bash
npm run dist:linux   # AppImage + deb
npm run dist:win     # NSIS 安装包（.exe）
npm run dist:mac     # dmg
```

产物输出到 `dist/`。

### 给学校的 Windows 电脑用

两种方式，都不需要装开发环境：

1. **直接拿安装包**：`npm run dist:win` 生成的 `dist/xiaoxiaoyunclient-v1.0.0-x64.exe`，双击安装即可（默认装到当前用户，可改安装目录）。
2. **CI 打包**：仓库已带 `.github/workflows/build.yml`，推 `v*` 标签或在 Actions 页面手动触发，会在真实的 `windows-latest` 上打包并把 `.exe` 作为 artifact 上传（14 天有效）。

在 Linux 上交叉打 Windows 包依赖 `wine`（本机已装）；没有 wine 的机器用方案 2 更省事。

### 快捷键

| 快捷键 | 作用 |
|---|---|
| `F5` / `Ctrl+R` | 刷新原网页 |
| 双击标题栏 | 最大化 / 还原 |

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
