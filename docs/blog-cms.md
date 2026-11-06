# Pages CMS 博客接入

## 日常写作

1. 打开 [Pages CMS](https://app.pagescms.org/)，用 GitHub 登录。
2. 将 Pages CMS 的 GitHub App 授权给 `lukewjh/voluki-website`，选择仓库和 `main` 分支。配置文件为根目录的 `.pages.yml`。
3. 进入「博客文章」，编辑已有文章或新建文章。正文可以可视化编辑，图片可在编辑器或媒体管理中上传。
4. 新文章默认是草稿。保持「草稿」开启并保存，仅保存内容；关闭「草稿」并保存后，博客会在正常约 60 秒的缓存窗口内更新。这里是按访问请求检查缓存，不是后台每分钟定时抓取。

文章仍保存在 `src/content/blog/*.md`。新建时可设置文件名，文件名决定文章 URL；保存后禁止在 CMS 中重命名，避免改标题时更改旧链接。现有三篇文章的 URL 保持不变。

CMS 是 GitHub 文件编辑器，保存和图片上传都会产生远程提交。本地开发前先同步远程提交。草稿开关仅控制网站是否展示文章；GitHub 仓库本身的公开范围由仓库设置决定。

## 首次部署配置

生产环境默认读取 `lukewjh/voluki-website` 的 `main`，无需新增数据库或迁移文章。

构建环境通过 `.node-version` 固定为已验证的 Node.js 24.16.0。若 Cloudflare 项目已设置 `NODE_VERSION`，请确保它不覆盖为旧版 Node（当前 HTML 清理依赖要求 Node.js 22.12 或更高版本）。

在 Cloudflare Pages → Settings → Variables and Secrets 中配置：

| 名称 | 内容 |
| --- | --- |
| `BLOG_GITHUB_TOKEN` | 推荐设为 Secret。使用只授权本仓库的 fine-grained GitHub token，Repository permissions → Contents: Read-only。不要填写到聊天、代码或 CMS 表单。私有仓库必须配置。 |
| `BLOG_GITHUB_REPO` | 可选，默认 `lukewjh/voluki-website`。 |
| `BLOG_GITHUB_BRANCH` | 可选，默认 `main`。 |

运行时从 `locals.runtime.env` 读取配置。公开仓库可不带 token，但 GitHub 匿名 API 配额较低；生产部署应配置只读 token，避免正常刷新和多地区访问触发限流。CMS 写入使用其 GitHub App 授权，与网站的只读 token 分开。

为 Production 配置上述变量；Preview 如需读取线上内容也需配置相应变量。变量配置后重新部署一次。首次接入需要构建部署，之后纯内容更新不再依赖部署。

在 Cloudflare Pages → Settings → Build → Build watch paths 设置：

- Include paths：`*`
- Exclude paths：`src/content/blog/*`、`public/content_imgs/*`

这两项排除仅在动态博客代码成功部署并验证后启用。它们只跳过文章和媒体变更引起的构建；其他代码、依赖及 `.pages.yml` 变更仍会构建。Cloudflare 的 `*` 可匹配嵌套路径。

## 内容和图片的读取方式

- `/blog/` 和 `/blog/[slug]/` 在 Cloudflare 上按请求渲染，不在构建时枚举文章。
- 网站读取 GitHub 的当前文件树；仅渲染 `src/content/blog` 目录第一层的 `.md` 文件，跳过草稿、不合法的文章和符号链接。
- 当前列表和正文共用约 60 秒的来源快照。未变化的文章按 Git blob SHA 复用解析结果。
- 图片上传到 `public/content_imgs`，CMS 写入正文的地址为 `/blog-media/...`。该路由根据同一份文件树读取图片的 blob，不依赖已部署的 `public/` 文件。
- 旧文章里的 `/content_imgs/...` 在渲染时映射到 `/blog-media/...`，旧文件无需改写。CMS 上传支持 PNG、JPEG、WebP、GIF、AVIF。
- Markdown 在服务器渲染并清理 HTML；保留标题、表格、代码高亮及安全的图片排版。旧文章中的脚本、事件属性、iframe 和其他不安全 HTML 不会执行。
- 普通页面不叠加浏览器/CDN 的一分钟缓存。图片按 ETag 重新验证，图片字节按不可变的 blob SHA 缓存。
- 来源请求超时或失败时，优先使用最近一次成功快照，最长保留一天；故障时内容更新可能超过正常窗口。没有可用快照时返回可重试的 503，不把旧构建中的文章重新当成最新内容。已发布内容被撤回后，在正常缓存窗口内从列表和详情消失。

当前每篇 Markdown 上限为 256 KiB，上传图片读取上限为 8 MiB；博客目录上限为 500 篇，渲染快照也有内存上限，适用于此个人博客。

## 本地开发与检查

`npm run dev` 默认读取本地 Markdown，图片路由转到本地静态文件。若要调试线上 GitHub 读取，可在已忽略的 `.env` 中设置 `BLOG_SOURCE=github`，并按需配置 `BLOG_GITHUB_TOKEN`，随后重启开发服务器。生产环境始终使用 GitHub。

```powershell
node --test tests/ai-settings.test.mjs tests/blog.test.mjs
npm run build
```

验收时在 CMS 新建一篇文章并上传图片：保存草稿后网站不出现；关闭草稿并保存后，约一分钟内列表和新文章链接可访问，配图可加载；随后再编辑正文，确认不需要整站部署。

## 官方文档

- [Pages CMS 接入](https://pagescms.org/docs/quick-start/)
- [Pages CMS 富文本编辑](https://pagescms.org/docs/configuration/fields/rich-text/)
- [GitHub 只读 token](https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens)
- [Cloudflare 构建监听路径](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)
