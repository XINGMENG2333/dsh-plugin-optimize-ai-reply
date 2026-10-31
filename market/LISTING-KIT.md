# 上架执行包 · dsh-market + GitHub

> 状态：**本地安装验证已通过**（见文末记录）；公开上架只差你的 GitHub 账号——三步执行，所有粘贴文本都已备好。
> 一键准备：`node scripts/prepare-listing.mjs --owner XINGMENG2333`

---

## 第 0 步：一键替换占位符（1 条命令）

```bash
node scripts/prepare-listing.mjs --owner XINGMENG2333
```

自动完成：9 个文件里的 `XINGMENG2333` / `XINGMENG2333` → 你的账号、重生成 `market/index.json`、跑一遍契约测试兜底。

## 第 1 步：创建 GitHub 仓库并推送（复制即用）

```bash
git remote add origin https://github.com/XINGMENG2333/dsh-plugin-optimize-ai-reply.git
git branch -M main
git push -u origin main
```

**推送后立刻打 topic（这是自动收录的命脉）**：

| 方式 | 操作 |
|---|---|
| 网页 | 仓库页 → 右侧 gear（About → Topics）→ 添加：`dsh-plugin` `dsh` `deepseek-harness` `optimize-ai-reply` `writing` |
| 命令 | `gh repo edit XINGMENG2333/dsh-plugin-optimize-ai-reply --add-topic dsh-plugin --add-topic dsh --add-topic deepseek-harness --add-topic optimize-ai-reply --add-topic writing` |

打完 `dsh-plugin` topic 后，社区市场（[2BingLing/dsh-market](https://github.com/2BingLing/dsh-market) 等）每日 06:00 自动扫描收录，**无需任何表单**。

## 第 2 步：awesome-dsh-plugin 精选列表 PR（`dshmarket` 唯一数据源）

1. 把 [awesome-dsh-plugin.yml](awesome-dsh-plugin.yml) 的内容原样放入对方仓库的
   `data/plugins/XINGMENG2333__dsh-plugin-optimize-ai-reply.yml`（文件名必须是 `owner__repo.yml`）。
2. 在对方仓库执行 `node scripts/generate-readme.mjs`，把重新生成的两个 README 一并提交。
3. 一个 PR 只加这一个文件。

**PR 标题（粘贴）**：

```
Add XINGMENG2333/dsh-plugin-optimize-ai-reply to the list
```

**PR 正文（粘贴）**：

```markdown
- [x] I added **one file** at `data/plugins/XINGMENG2333__dsh-plugin-optimize-ai-reply.yml` — the READMEs are generated, don't edit them by hand
- [x] I ran `node scripts/generate-readme.mjs` and committed the regenerated READMEs

<!--
## 插件简介 / About

**优化 AI 回复（Optimize AI Reply）** —— DeepSeek Harness 插件：

- **本地密度扫描**：54 条规则（A 组实测基线 / B 组共识 / C 组禁止清单），密度对照人类基线判「正常·观察项·偏高·高」，零网络
- **五层校验 + 闭环复扫**：事实（数字/URL/代码/引文/专名）· 强度与主次 · 安全信息 · 结构；校验不过自动回退原文，绝不交付更差文本
- **7 个工具**覆盖 L0–L6：optimize_reply_scan / brief / verify / rescan / check / style_prompt / rulecheck
- **实测**：40 段真人语料误报 0%、20 段 AI 检出 100%；156 项测试全绿
- package.json 含 `dsh.bundle`，`dsh plugin add` 可直接安装；MIT
-->
```

## 第 3 步：市场渠道（按需选做）

### 3a. dsh-marketplace.com 网页提交

<https://www.dsh-marketplace.com/submit>，表单逐项填：

| 字段 | 填写值 |
|---|---|
| Plugin name | 优化 AI 回复 (Optimize AI Reply) |
| Package name | `dsh-plugin-optimize-ai-reply` |
| Repository URL | `https://github.com/XINGMENG2333/dsh-plugin-optimize-ai-reply` |
| Category | writing（或 tools） |
| Description (en) | Optimizes AI replies: local density scanner with human baselines, five-layer fact/strength/safety verification, closed-loop rescan. |
| Description (zh) | 优化 AI 回复：本地密度扫描 + 五层校验改写 + 闭环复扫，事实/强度/安全零损失。 |

### 3b. 自托管市场索引（可选）

把 [index.json](index.json) 发布到任意静态源（GitHub Pages 即可），用户在 DSH
**Plugins → More → Custom plugin markets → Discover → Add index source** 填 URL 即可浏览安装。
索引已内联图标，单文件托管即可；版本升级后跑 `node scripts/build-market-index.mjs` 重新生成。

### 3c. npm 发布（可选，市场 npm 源生效）

```bash
npm login && npm publish --access public
```

发布后 `dsh plugin --profile <名字> add dsh-plugin-optimize-ai-reply` 直接可用；
打 tag 发布 GitHub Release 时，[Release 工作流](../.github/workflows/release.yml) 会自动上传
`dsh-plugin-optimize-ai-reply.tgz`（tarball 一键安装渠道）并自动 npm publish。

---

## 本地安装验证记录（已完成，2026-10-31）

| 步骤 | 结果 |
|---|---|
| `dsh plugin --profile listing-check add <本仓库>` | ✅ profile 初始化 + `dsh-plugin-optimize-ai-reply link:…` 安装成功（link 模式，零构建、无需 allowBuilds） |
| `dsh --profile listing-check --dump-config` | ✅ 出现 `# == dsh-plugin-optimize-ai-reply` 配置层，行 `id: optimize-ai-reply / name: dsh-plugin-optimize-ai-reply` 正确插入 |
| 工具注册（7 个） | ✅ 契约测试 20/20 + ESM 加载冒烟（optimize_reply_scan…rulecheck 全部注册，坏改写正确 revert） |

用户侧安装命令（三条渠道任选）：

```bash
dsh plugin --profile demo add dsh-plugin-optimize-ai-reply            # npm（发布后）
dsh plugin --profile demo add github:XINGMENG2333/dsh-plugin-optimize-ai-reply   # GitHub
dsh plugin --profile demo add ./dsh-plugin-optimize-ai-reply.tgz      # 预构建 tarball
```

## 上架自检清单

- [ ] `prepare-listing.mjs --owner …` 已跑（占位符清零）
- [ ] 仓库已推送、topic 已打（`dsh-plugin` 必打）
- [ ] awesome-dsh-plugin PR 已提交（文件名 `owner__repo.yml` ✓、generate-readme 已跑 ✓）
- [ ] （可选）dsh-marketplace 提交 / 市场索引托管 / npm publish
- [ ] README 顶部 CI badge 随仓库生效
