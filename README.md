# dsh-splash-screen

[![License: MIT](https://img.shields.io/badge/License-MIT-4f7d24.svg)](LICENSE)
![DSH plugin](https://img.shields.io/badge/DSH-plugin-1f2a12)

> DSH 的开屏动画插件 —— 全屏启动动画，**可跳过**，纯插件实现，可在侧栏「插件」页开关。
> *A skippable full-screen splash animation for [DSH](https://github.com/deepseek-ai) (DeepSeek Harness), shipped as a pure plugin.*

配色取自淡绿清晨（森林绿舞台 + 奶白绿底 + 嫩绿信号色），与外观预设「淡绿·林间」对齐。
动画的文案、图形、配色均为本项目原创，不含任何第三方 IP 的词汇、标识或素材。

> 想先看效果：用浏览器打开仓库里的 [`preview/index.html`](preview/index.html) 即可，
> 不需要 DSH、不需要构建。

---

## 它长什么样

一块森林绿的舞台，四角制式括号、细线框架、等宽字读数带；中央是 `DEEPSEEK HARNESS / DSH` 巨型字标，
下方一条细线随进度亮起；底部是分段进度条 + 刻度尺 + 逐位跳动的百分比计数器；
一条真实本地时间的时钟与一行打字机状态词；右下角 `SOUND` / `SKIP` 两个控件。

两段式结构：**A 段** canvas 点阵把字标拆成粒子，先弥散再收敛成 `DEEPSEEK → HARNESS → DSH`
（每颗点按贪心最近邻重组，所以收敛是有机的，不是按下标硬飞）；**B 段**点阵散场，
立绘从左侧淡入做底纹，字标从遮罩里升起，末段斜切滑幕出场。

| 时间 | 动作 |
|---|---|
| 0–300ms | 刻意留白（纯底色，只铺字体与网格） |
| 300ms | 四角括号以 `scaleX/scaleY` 从外侧展开，顶部读数带淡入 + 横线从中心拉开 |
| 600ms | 字标两行从遮罩里 `translateY(105%) → 0` 升起（第二行延迟 110ms）；音效起 |
| 600ms– | 细线 `scaleX(0→1)` 自左展开，副标签、打字机、进度区依次淡入 |
| 0–3.5s | 百分比按阶段非线性逼近（中段刻意放缓形成「停顿感」），状态词随之切换 |
| 2.7s | 一次 140ms 的色分离故障闪烁 |
| 4.2s | 交棒：斜切面板 `translateX` 滑幕 600ms 出场，露出工作区 |

- **跳过**：鼠标点击任意处 / 按任意键 / 触屏 / 滚轮，或点右下角 `SKIP`。跳过不是硬切，
  而是先 180ms 收束再走同一条 600ms 滑幕。
- **音效**：默认**关闭**。右下角 `SOUND` 打开，偏好记在 `localStorage`。音效是运行时合成的
  （一段气声扫频 + G4/D5/G5 三枚正弦），不带音频素材文件，也不受浏览器自动播放策略影响。
- **无障碍**：容器带 `role="progressbar"` 与 `aria-valuenow`，状态变化有 `aria-live` 播报；
  尊重 `prefers-reduced-motion: reduce`（退化为静态终帧 + 900ms 后交棒）。
- **只播一次**：同一页面会话内只播一次（`sessionStorage`）。重开窗口 / 重启应用会重新播放。

---

## 安装

需要已安装 DSH（桌面版或浏览器版）。`dsh plugin` 会经由 pnpm 把本仓库装进目标 profile。

### 从 GitHub 安装（推荐）

```powershell
# 桌面版
dsh plugin --profile desktop add "git+https://github.com/52baihehhh-ai/dsh-splash-screen.git"

# 浏览器版：profile 名是 web
dsh plugin --profile web add "git+https://github.com/52baihehhh-ai/dsh-splash-screen.git"
```

`github:52baihehhh-ai/dsh-splash-screen` 是等价简写。也可以在侧栏 **插件** 页面里粘贴上面这个地址安装。

装完**重启一次桌面应用**：node 半的注入行是宿主启动时收集并交给渲染进程的，
重启后开屏才会出现在界面挂载之前（client 半本身的改动是实时的，不需要重启）。

> 若你的 DSH 配置目录不是默认的 `~/.dsh`，先设 `$env:DSH_HOME` 指向它再执行上面的命令。

### 本地源码（开发用）

```powershell
dsh plugin --profile desktop add "link:C:\path\to\dsh-splash-screen"
```

它做三件事，缺一不可：

1. 在 `profiles\<profile>\package.json` 的 `dependencies` 里写入 `"dsh-splash-screen": "link:<插件目录>"`；
2. 在 `node_modules\dsh-splash-screen` 建一个指向插件目录的 junction；
3. 把 `dsh-splash-screen` 追加进 `dsh.profile.bundles`（这是它出现在插件库里的原因）。

---

## 开关 / 卸载

侧栏 **插件** 页面里，`DSH 开屏动画` 这张卡就是本插件（标题与描述来自 `locale/zh.json`）：

- 卡上的总开关 = 本 bundle 是否参与组合（改 `dsh.profile.bundles`）。关掉即两半一起消失，
  开屏彻底不出现；重新打开会追加到数组末尾。
- 卡片内 `dsh-splash-screen` 这一行的开关 = 写 profile 的 `cordis.patch.yml`：

  ```yaml
  - id: dsh-splash-screen
    disabled: true
  ```

  这一行是**隔离预案**：出错时手工加上它就能把插件摘出组合，无需卸载。

只卸载不保留源码：

```powershell
dsh plugin --profile desktop remove dsh-splash-screen
```

设置 → 插件 → 插件列表是只读清单，不在这里改。

---

## 结构

```
dsh-splash-screen/
├─ src/splash.js          动画本体（唯一起源，vanilla、无依赖、不接触 React）
├─ scripts/build.mjs      构建器：src/splash.js → client.js + index.js
├─ client.js              构建产物·client 半（懒 CJS bundle）
├─ index.js               构建产物·node 半（结构化注入行）
├─ cordis.patch.yml       挂载声明：把本插件的 Loader 行插进配置树
├─ art.webp               立绘贴图（发行用压缩版，运行期走宿主路由按需加载）
├─ package.json           声明 dsh.bundle.patch 与 dsh.client（platform: web）
├─ locale/{zh,en}.json    插件库里显示的标题与描述
├─ preview/index.html     独立视觉预览（自带迷你宿主，不需要 DSH 就能看效果）
└─ test/                  三个自测脚本（见「开发」）
```

### 为什么两半都要有

`@deepseek-ai/dsh-client-modules` 只为「存在一条活的、已启用的 Loader 行、且该行模块能解析到本包」
的包下发浏览器 bundle。没有 node 半就没有 Loader 行，`client.js` 既不会被发现、也不会由 `/plugins` 下发。
所以 node 半哪怕是空的也必须存在。

### node 半：封面（无闪切换）

宿主自带的启动壳（`[data-dsh-boot]`：HARNESS + 转圈 + Loading plugins…）在应用挂载前就会出现。
为了不让它先闪一下，node 半用官方的结构化注入行 `webserver/index-inject` 往 index 里塞两行纯 JSON：

- `{ kind: 'style', text: … }` —— 同底色的封面样式；
- `{ kind: 'script', placement: 'head', text: … }` —— 立刻铺出封面节点（底色与开屏舞台完全一致），
  并提供三条退出路径：client 半挂载时主动摘除、`#root` 出现真实应用内容时兜底摘除、
  3.5 秒硬超时强制摘除（client 半正常会在数百毫秒内接管）。

**为什么不用 `tapIndex`**：桌面版主窗口走 `dsh-app://` 协议直读 SPA 的 `index.html`，从不调用
`renderIndex()`，所以 `tapIndex` 在桌面端是死代码；结构化注入行由桌面主进程经 IPC 下发给渲染进程
解释执行，浏览器 / 桌面主窗口 / 悬浮窗三个表面都能拿到。

**注入行的纪律**：宿主对注入行做白名单校验，未知 `kind` 会让 boot gate 直接 reject，
把桌面端打进崩溃恢复页。因此这里只产出 `style` / `script` 两种最稳的行，
并且注入脚本自带语法与幂等测试（见「开发」）。

### client 半：动画本体

- 手写 `window.__ModuleLoader__.load({ id, factory })` 包装，符合懒 CJS 契约：文件体只注册 factory，
  副作用（挂 DOM）在首次物化时执行。
- `factory(require)` 返回普通 Cordis 插件对象 `{ name, inject, apply }`；`react` 由平台模块表解析，
  不打包、不 import 任何宿主包。
- 动画挂进 `shell.overlay` 槽位（`ui-layout` 声明的 root 级 list 槽），自己只 `position: fixed`
  铺满并给 `z-index: 9000`，不吃全局层级。
- 内部用 **Shadow DOM** 包住开屏，样式绝不外溢到宿主界面。
- 对外只暴露 `globalThis.__DSH_SPLASH__ = { createSplash, destroySplash }`。

---

## 已知边界

- **没有「应用启动即显示」这一档**。桌面主窗口是 `show: false` 创建、等宿主 ready 后才 `show()` 的，
  窗口级开屏需要改安装包（本插件明确不做）。能覆盖的是「窗口出现 → 界面挂载 → 动画结束」这一段。
- 注入表是**宿主启动时**收集并交给 Electron 的。新装 / 新增注入行需要**重启一次桌面应用**才会生效；
  client 半本身的改动是实时的。
- 浏览器 GUI 的 index 由 `renderIndex()` 渲染，注入行直接进 HTML，因此浏览器端刷新即生效。
- 桌面窗口高度前 40px 是原生标题栏（`titleBarStyle: "hidden"` + `titleBarOverlay`）。
  开屏是全屏遮罩，会盖住这条带；若想避开，在 CSS 里给 `.dshs-root` 加 `top: 40px` 即可。

---

## 开发

无运行时依赖，只需要 Node ≥ 20.11。`src/splash.js` 是唯一起源，`client.js` 与 `index.js` 都是构建产物，
**两个都要提交**（DSH 安装时不跑构建）。

```bash
node scripts/build.mjs          # 构建 client.js + index.js
node scripts/build.mjs --check  # 只比对不写盘（CI 用；产物过期就非零退出）
npm test                        # 跑三个自测脚本
```

`npm test` 包含：

| 脚本 | 覆盖 |
|---|---|
| `test/splash-smoke.mjs` | client 半契约 + 点阵引擎 + 完整时间轴 + 收尾 + 槽位注册 |
| `test/node-half-check.mjs` | 注入行合法性（白名单 kind）+ 覆盖样式 + 注入脚本语法与关键逻辑 |
| `test/wiring-check.mjs` | React 接线：Overlay → effect → `createSplash` → 收尾 → 对外契约 |

三个脚本都用最小 DOM / canvas / 迷你 React 替身，**不需要浏览器，也不需要 DSH 在跑**。
每个脚本都可以单独跑，并接受一个可选参数指向待测文件（默认读仓库根目录的产物）：

```bash
node test/splash-smoke.mjs path/to/client.js
node test/node-half-check.mjs path/to/index.js
```

### 视觉预览

`preview/index.html` 自带一个迷你宿主（伪 `__ModuleLoader__` + 伪 `React` + 伪 `ctx.slots`），
把同一份 `client.js` 跑起来，底下压一个仿 DSH 的界面壳，右下角有「重播开屏」。
直接用浏览器打开该文件即可，不需要 DSH、不需要构建。

### 换成你自己的立绘

`scripts/build.mjs` 按 `art.webp → art.png → art.jpg → art.jpeg` 的顺序找贴图，只记录**文件名**，
运行期由宿主路由按需提供。所以：把 `art.webp` 换成你自己的图（保持文件名）后重新构建即可。
原图（`art-original.png` 等）已在 `.gitignore` 里，不会进仓库——它是 `art.webp` 的来源，
留在本地备份即可。

> 贴图**不内联**成 data URI：一张竖版立绘 base64 之后有十几 MB，会把注入脚本撑爆，
> 而且大图解码会直接把主线程堵住、开屏卡顿。

---

## 排障（出错时按顺序做）

1. **只停插件**：编辑 `~/.dsh/profiles/<profile>/cordis.patch.yml`，追加

   ```yaml
   - id: dsh-splash-screen
     disabled: true
   ```

   或直接在侧栏插件页拨开关。两半一起失效，开屏不再出现。
2. **摘出组合**：从 `profiles/<profile>/package.json` 的 `dsh.profile.bundles` 里删掉
   `dsh-splash-screen`（保留依赖即可让插件库仍能看到它是关着的）。
3. **完整卸载**：`dsh plugin --profile desktop remove dsh-splash-screen`。
4. **源码侧彻底隔离**：把插件目录改名（junction 会失效），宿主只看到一条加载失败的行，
   不会影响其它插件。
5. 任何一步之后，桌面端需要**重启应用**让注入行消失。

安装过程只经由官方 CLI 追加了三处内容（依赖、junction、bundles 数组），没有改动
`profiles/<profile>/cordis.yml`、`cordis.patch.yml` 或已装插件。

---

## 许可

MIT，见 [LICENSE](LICENSE)。

动画的文案、图形、配色均为本项目原创；动效手法参考的是公开可观察的网页实现惯例
（状态类 + transform/opacity、rAF 驱动计数器、斜切滑幕），未复制任何第三方素材或文本。
