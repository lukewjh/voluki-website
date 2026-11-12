# 用 Pages CMS 更新 IELTS-Speaking

1. 在 [Pages CMS](https://app.pagescms.org/) 打开 Voluki 仓库的 `main`，进入「IELTS-Speaking 口语答案」。
2. 搜索话题标题，打开对应题目，编辑「基础版」或「升级版」后保存。升级版可以留空。答案用纯文本编辑，空一行即可分段。
3. 保存会提交到 GitHub。正常情况下，约 60 秒后刷新网站或重新打开题卡即可看到更新。卡片和导图使用同一个话题页的答案。

题库位于 `tiku-answer/2026-sep-dec/`，每个话题一个 JSON 文件。原题、题号、分组和顺序用于定位题卡，答案通过同一题号写回页面。Part 2 和对应的 Part 3 在同一话题里。

## 部署与验收

首次接入需要部署一次。线上沿用博客的 `BLOG_GITHUB_REPO`、`BLOG_GITHUB_BRANCH` 和只读 `BLOG_GITHUB_TOKEN` 设置。网站访问时只取当前话题的文件，按话题缓存约 60 秒。同步失败时会显示最近一次同步的答案，并提示同步状态。冷启动遇到失败时显示本次部署时的答案。

首次部署后，在 CMS 修改一道题并保存。约一分钟后用卡片和导图各打开一次，确认两处显示的是同一版答案。验证成功后，可在 Cloudflare Pages 的 **Settings → Build → Build watch paths** 中保留现有排除项并加上 `tiku-answer/2026-sep-dec/*`。纯答案提交随后可跳过构建。目录或题目结构变更需要构建部署，若只修改了已排除的题库路径，可以手动触发构建。

本地开发默认读取工作区文件。需要调试线上读取时，可以用 `SPEAKING_SOURCE=github` 启动开发服务。

[Pages CMS 集合配置](https://pagescms.org/docs/configuration/content/) · [Cloudflare 构建监听路径](https://developers.cloudflare.com/pages/configuration/build-watch-paths/)
