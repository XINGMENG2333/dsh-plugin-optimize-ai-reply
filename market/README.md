# 市场与收录（market/）

**要上架？直接看 [LISTING-KIT.md](LISTING-KIT.md)**——三步执行包，PR 标题/正文、表单字段、安装验证记录全部现成。
插件使用提示词见 [../PROMPT.md](../PROMPT.md)。

本目录是「优化 AI 回复」插件进入 **DSH 插件市场** 与 **GitHub 生态** 的收录材料。三条路径按省事程度排序：

## 路径一：GitHub topic 自动收录（最快，推荐先做）

给仓库打上 topic：**`dsh-plugin`**（建议同时加 `dsh`、`deepseek-harness`）。
社区市场（如 [2BingLing/dsh-market](https://github.com/2BingLing/dsh-market)）每日 06:00 自动扫描 GitHub 上带 `dsh-plugin` topic 的仓库并收录，无需提交任何表单。

## 路径二：awesome-dsh-plugin 精选列表（dshmarket 插件的唯一数据源）

`dshmarket`（官方市场插件）只允许安装精选列表内的来源，收录方法是向
[awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提一个 PR：

1. 复制本目录的 [awesome-dsh-plugin.yml](awesome-dsh-plugin.yml) 为 `data/plugins/<XINGMENG2333>__dsh-plugin-optimize-ai-reply.yml`
   （文件名规则：`owner__repo.yml`，必须与 `url` 字段一致；先替换 yml 里的 `XINGMENG2333`）。
2. 在对方仓库执行 `node scripts/generate-readme.mjs`，把重新生成的 README 一并提交。
3. 一个 PR 只加这一个文件。描述必须单行；含 `: ` 的行要加引号；`description.en` 必须以句号结尾。

> 前置条件（对方校验）：仓库 `package.json` 必须含 `dsh.bundle`（本仓库 ✓），浏览器 UI 组件才需要 `dsh.client`（本插件不需要）。
> 选填 `tarball` 指向 GitHub Release 的预构建包（Release 工作流会自动上传 `dsh-plugin-optimize-ai-reply.tgz`）。

## 路径三：自托管/提交市场索引（format 1）

[index.json](index.json) 是标准 **format 1** 市场索引（由 `node scripts/build-market-index.mjs` 生成，图标已内联）。
任意静态托管（GitHub Pages / 对象存储）即可成为一个市场源：

1. 把 `market/index.json` 发布到 `https://<你的域名>/index.json`；
2. DSH 里打开 **Plugins → More → Custom plugin markets**（实验特性）→ **Discover → Add index source**，填入 URL；
3. 或把本文件提交给第三方市场维护者收录（如 [dsh-marketplace.com/submit](https://www.dsh-marketplace.com/submit)）。

## 安装方式（收录后用户侧）

```bash
# 从 npm（发布后）
dsh plugin --profile demo add dsh-plugin-optimize-ai-reply

# 从 GitHub（无需 npm 发布；首次需放行 prepare 构建）
dsh plugin --profile demo add github:XINGMENG2333/dsh-plugin-optimize-ai-reply

# 本地目录 / 预构建 tarball
dsh plugin --profile demo add ./optimize-ai-reply
dsh plugin --profile demo add ./dsh-plugin-optimize-ai-reply-2.1.0.tgz
```

## 发布清单（打 tag 前把占位符换掉）

- [ ] `package.json` 的 `repository` / `homepage` 中 `XINGMENG2333` → 真实账号
- [ ] `scripts/build-market-index.mjs` 的 `OWNER_PLACEHOLDER` → 真实账号，重跑生成 `market/index.json`
- [ ] `market/awesome-dsh-plugin.yml` 的 `url` / `name` / `tarball` 中 `XINGMENG2333` → 真实账号
- [ ] `npm publish`（或走 Release 工作流的自动发布）
- [ ] 打 GitHub topic：`dsh-plugin` `dsh` `deepseek-harness`
