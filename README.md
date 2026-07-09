# Voluki

A minimal personal blog built with Astro and Markdown.

## Commands

```bash
npm install
npm run dev
npm run build
```

## Writing

Add posts in `src/content/blog`.

```md
---
title: "Post title"
description: "Short summary."
date: "2026-06-06"
tags: ["notes"]
---

Your post goes here.
```

## Cloudflare Pages

- Build command: `npm run build`
- Output directory: `dist`

## Vibe Coding
### 2026.6.11
新增了SRT Console（Sentence Reverse Translation Console）

粘贴一篇英文范文，先拆成中文句子， 再逐句翻回英文。 

最后用 AI 对照原文、你的表达和建议版本，沉淀语法、 表达、chunk 与句型。 

使用codex开发

使用cloudflare.com部署 

目的是帮助想提升雅思写作基础能力进行有结构的分析，提升地道表达chunk、句型结构、写作语法等等
下一步：增加AI的请求速度

### 2026.6.14
新增了 导出为pdf

可以将练习的文章进行打印

下一步：支持下载anki卡组模版

支持文章中的chunk收集、句型收集导出为csv，方便快速导入至anki中复习

### 2026.6.16
1.新增了灯泡功能：帮助获得chunk提示

2.新增了markdown笔记功能支持本地浏览器缓存笔记内容、支持下载

### 2026.07.02
1.新增了RIO页面（beta）

2.主要功能是对随机抽卡的chunks、pattern、adv、vocabs提供既有输入又有输出的环境，针对性练习

备注：还应该新增一个（自选模式），这样可以让用户可以更加针对性的练习those chunks, pattern, vocabs, adv they really want to practice.

### 2026.07.03
1.新增自选模式

2.将训练更原子化，更加贴合训练流程（输入理解 to 输出应用）

备注：下一步适当增加一些训练时的音效（for example 用户输入时的键盘敲击音），让训练更上瘾

3.新增句型Quiz模式，快速刷句型，记得更牢

备注：看看需不需要把所有列表都加上这个功能，像是玩游戏


### 2026.07.03
1.新增Vocbs、advs、chunks的Quiz模式
- Vocbs 语境下的同义替换
- advs 语境下的感情判断  
- chunks 是完型填空

备注：

advs 还缺少点灵活性，现在的模板有点太固定了 

需要支持键盘快捷键来控制Quiz回答


### 2026.07.08
1.将Vocabs中的Quiz改为 知识图谱、语境理解的匹配模式

2.将Chunks Quizs也改为 短句匹配模式

3.修复徽章展示不全的bug

备注：需要支持键盘快捷键来控制Quiz回答


### 2026.07.09
1.优化chunks quiz的生成体验

2.模态框关闭策略，只允许点击叉号关闭

