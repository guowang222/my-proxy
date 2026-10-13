# my-proxy

在只放行 GitHub 的受限网络里，用浏览器像平时一样浏览外部网站。

## 原理

```
浏览器（frontend）
   │  iframe 加载 /proxy?url=<目标网址>
   ▼
代理服务（proxy/server.js，跑在 GitHub Codespaces）
   │  Express 抓取目标网页，用 cheerio 改写所有链接/图片/脚本
   ▼
任意外部网站
```

关键点：**能出网的是 Codespaces，不是你的浏览器**。你的网络只需要能访问
`*.app.github.dev`（GitHub 的端口转发域名），其余流量由 Codespaces 代劳。

## 部署

### 1. 建 Codespace

在 GitHub 仓库页面点 **Code → Create codespace on main**。

首次创建时，`.devcontainer/devcontainer.json` 会自动：
- 安装依赖
- 后台启动代理服务
- 把 3000 端口设为**公开**转发

### 2. 拿到转发地址

Codespaces 创建后：
- 打开 **PORTS** 面板，看到 `web-proxy` / 3000
- 右键 → **Copy Public URL**，形如：
  ```
  https://<codespace名>-3000.app.github.dev
  ```

若端口显示为 `Private`，点 **Port Visibility → Public**。

### 3. 打开前端

三种方式，任选：

**A. 直接开 Codespace 里的文件（最简单）**
`.devcontainer` 已配置自动打开 `frontend/index.html`。页面载入时会自动探测
3000 端口地址，通常无需任何配置。

**B. 部署到 GitHub Pages**
在仓库 Settings → Pages → Source 选 GitHub Actions。我可以帮你加部署
workflow。

**C. 本地打开**
下载 `frontend/` 目录，双击 `index.html`。此时需手动填入步骤 2 的地址。

### 4. 使用

在地址栏输入网址回车。若首次未自动探测到代理，点右上角 ⚙ 手动填入转发地址。

## 本地开发

```bash
cd proxy
npm install
node server.js          # 监听 3000

# 另开浏览器打开 frontend/index.html
```

健康检查：`curl http://127.0.0.1:3000/health`

## 目录

```
proxy/server.js         Express 代理 + cheerio 改写
proxy/package.json
frontend/index.html     浏览器壳：地址栏 + iframe
frontend/app.js         导航、历史、书签、自动探测
frontend/style.css
.devcontainer/          Codespaces 自动部署配置
```

## 已验证

本地实测（Node 22）：

| 项目 | 结果 |
|---|---|
| `/health` | 200 |
| 抓 example.com | 200，标题正确 |
| HTML 链接改写 | 生效 |
| `fetch` / `XHR` 拦截注入 | 生效 |
| CSS `url()` 改写 | 相对路径→绝对路径正确，`data:`/`#`正确跳过 |
| 二进制/文本透传 | 正常 |

## 已知限制

- **Codespaces 空闲约 30 分钟自动休眠**，休眠后代理中断，恢复需十几秒。
  长时间使用可在 Settings → Idle timeout 调大。
- **仅支持 HTTP/HTTPS**，HTTPS 证书在代理侧终止，不做证书校验。
- **登录态有限**：Cookie 会转发，但目标站的风控可能识别出非本地浏览器。
- **不是匿名代理**：出口 IP 是 GitHub 的共享 IP，很多站点会限流或拒绝。
- **动态渲染页面**（前端框架渲染的内容）需要注入脚本生效，部分站点仍可能
  显示不全。

## 安全提醒

这个服务是**开放代理**——任何拿到转发地址的人都能用它访问外网。Codespaces
的公共端口是凭地址访问的，不要泄露 `https://<name>-3000.app.github.dev`。

若需加固，可加一层访问令牌校验，或把端口改为 Private（但那样只有能访问
GitHub 的你自己能用，失去通用性）。