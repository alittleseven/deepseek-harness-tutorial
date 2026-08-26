# 部署说明：把本教程发布到你的网站

本目录已用 **VitePress** 把全部 Markdown 文档构建成一个**分层静态站**，构建产物在 `.vitepress/dist/`。它是纯静态文件（HTML/CSS/JS），只需把里面所有文件上传到任意静态服务器即可。
（本文件在源目录；`dist` 是最终要上传/托管的内容。）

---

## 1. 你的产物是什么

```
.vitepress/dist/
├── index.html                # 网站首页（显示 README 书籍介绍）
├── chapters/                 # 正文 01–17 章
│   ├── 01-从一条命令到一棵插件树.html
│   └── ... 共 17 个
├── appendix-a-glossary.html  # 附录 A 术语表
├── appendix-b-api-config.html# 附录 B API 与配置速查
├── appendix-c-source.html    # 附录 C 源码清单与参考文献
├── answers.html              # 习题解答
├── assets/                   # JS/CSS/搜索索引等静态资源
└── 404.html                  # 找不到页面的兜底页
```

页面之间有**侧边栏层级**（开始 / 正文十七章 / 附录 / 习题解答）、**顶部导航**、**全文搜索**、**深色模式**、**上一章/下一章**、**回到顶部**。

---

## 2. 重新构建（改动文档后）

只需重新生成静态文件：

```bash
npm install      # 首次
npm run build    # 输出到 .vitepress/dist/
```

本地预览：

```bash
npm run preview   # 打开 http://localhost:4173
```

---

## 3. 部署到你的网站（三种常见方式，任选其一）

### 方式 A：域名指向 Vercel / Netlify（推荐，零运维）

- 把本目录推到 GitHub/GitLab。
- 在 Vercel 或 Netlify 导入该仓库：
  - 构建命令 `npm run build`
  - 输出目录 `.vitepress/dist`
- 平台会生成一个 `xxx.vercel.app` / `xxx.netlify.app` 地址，再把你的域名通过 DNS 解析或 CNAME 指向它，官方面板里"绑定自定义域名"即可。

### 方式 B：你已有的虚拟主机 / 服务器（Nginx、Apache、宝塔等）

把 `.vitepress/dist/` 里的**所有内容**（index.html、chapters/、assets/ 等）上传到网站根目录或子目录。

- **根目录部署**（域名就是 https://你的域名/）：内容直接放网站根目录，例如 `/var/www/html/`。此时不需要改任何配置。
- **子目录部署**（例如 https://你的域名/docs/）：需要改一件事——在 `.vitepress/config.mjs` 中把 `base: '/'` 改成 `base: '/docs/'`，再 `npm run build`。否则 JS/CSS 路径会 404。

#### 用 Nginx 部署示例（子路径 `/docs/`）

```nginx
location /docs/ {
    alias /var/www/html/docs/.vitepress/dist/;
    index index.html;
    try_files $uri $uri/ /docs/index.html;
}
```

### 方式 C：本地 FFSFile/FTP 上传

很多虚拟主机面板（cPanel、宝塔、虚拟主机管理）支持文件管理或 FTP。直接把 `dist` 里所有文件按原结构上传到 `wwwroot` 或 `htdocs`（根目录时），即可访问 `https://你的域名/`。

---

## 4. 绑定你已有的域名

无论用哪种托管，最终都在域名服务商处把域名解析过去：

- **Vercel/Netlify**：在控制台 Add Domain，按提示加一条 `CNAME` 或 `A` 记录。
- **自有服务器**：在域名商把 `A` 记录指向服务器 IP；如用到子路径按上面方式二配置。

改完 DNS 后等生效（几分钟到几小时），首次建议开启 HTTPS（Vercel/Netlify 自动；服务器用 Let's Encrypt/宝塔 SSL）。

---

## 5. 常见问题

- **页面样式/JS 全 404**：多半是 `base` 配错了。子路径部署一定要在 `config.mjs` 里设 `base`，并重新 build。
- **首页 `/` 变 404**：请确认已经上传了 `index.html`（VitePress 用 `index.md` 作为首页，本目录已提供）。
- **`{{ }}` 或源码里的尖括号显示异常**：无需处理，我们已在 markdown 配置里关闭原始 HTML、并把花括号转义为实体，正文里的模板插值/泛型会被当作普通文本展示。
- **改了文档没生效**：重新 `npm run build`，确保上传的是新的 `dist`。

---

## 6. 自定义

- 站点标题、导航、侧边栏层级、主题色：都在 `.vitepress/config.mjs`。
- 想改欢迎页就编辑 `index.md`（它 `@include` 了 `README.md`；若想直接写首页，把 README 内容放到 `index.md` 并删掉那行 include 即可）。
- 默认主题是 VitePress 内置主题（蓝紫主色）。如需 GitHub 风格/品牌定制，可再加 `src` 自定义主题。
