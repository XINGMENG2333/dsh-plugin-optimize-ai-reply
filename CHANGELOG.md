# Changelog

## 2.2.0 — 2026-10-31 · 更名为「优化 AI 回复」

- 产品名、npm 包名、DSH 行 id、7 个工具名整体更名：**优化 AI 回复（Optimize AI Reply）**，包名 `dsh-plugin-optimize-ai-reply`，工具前缀 `optimize_reply_*`。
- 市场索引、awesome-dsh-plugin 提交文件、Chrome 扩展、demo 页、CI/Release 资产名同步更新。
- 内嵌提示词 A/B 为规格逐字内容，原文保留不动。

## 2.1.0 — 2026-10-31 · DeepSeek Harness 插件化

- **DSH bundle**：`package.json` 声明 `dsh.bundle` + `cordis.patch.yml` + 双入口（`index.js` CJS / `index.mjs` ESM），`engines.dsh: ">=0.2.0"`，可 `dsh plugin add` 安装。
- **7 个 harness 工具**（`src/dsh/tools.js`）：`optimize_reply_scan`（L2 本地扫描）、`optimize_reply_brief`（L3 改写任务书）、`optimize_reply_verify`（L4 五层校验）、`optimize_reply_rescan`（L5 闭环复扫）、`optimize_reply_check`（L4+L5 一站式验收）、`optimize_reply_style_prompt`（L1 生成侧提示词）、`optimize_reply_rulecheck`（规则体检）。
- **配置 Standard Schema**（`src/dsh/schema.js`）：defaultRegister / defaultModel / thresholdMultiplier / showWatchlist / disabledRules，零依赖实现 Standard Schema v1。
- **市场收录材料**（`market/`）：format 1 市场索引生成器、awesome-dsh-plugin 提交文件、官方生成器 plugins.txt、收录指南。
- **GitHub 工程化**：CI（Node 20/24 三套测试 + 市场索引漂移检查）、Release 工作流（npm publish + tarball + Chrome zip 自动上传）。
- 修复：`rewrite.js` 惰性解析 Verify/Rescan，脚本装载顺序不再是隐患。

## 2.0.0 — 2026-10-31 · Chrome MV3 扩展（规格 v2.0 全量实现）

- L0–L6 流水线：识别 → 生成侧注入 → 本地扫描 → 改写（事实占位符保护）→ 五层校验 → 闭环复扫 → 输出。
- 规则库 54 条全字段：A 中文 15+1、A 英文 12（含 sloptells 实测子项）、B 共识 16、C 禁止清单 10；数字全部经数据源核对（docs/source-notes.md）。
- 验收 8 条全过：真人误报 0/40、AI 检出 20/20、事实零漂移、强度/安全/闭环/时效/降级全部拦截生效。
- 侧栏/弹窗/设置页、内容脚本抓取、demo 页、构建脚本。
