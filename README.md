# 优化 AI 回复 · Optimize AI Reply

[![CI](https://github.com/your-github-id/dsh-plugin-optimize-ai-reply/actions/workflows/ci.yml/badge.svg)](https://github.com/your-github-id/dsh-plugin-optimize-ai-reply/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![dsh-plugin](https://img.shields.io/badge/dsh-plugin-blue.svg)](https://github.com/topics/dsh-plugin)
[![Node >=18](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)

**DeepSeek Harness 插件**（包名 `dsh-plugin-optimize-ai-reply`）：把大模型输出改成读起来像人写的——本地密度扫描（人类基线）+ 五层校验改写 + 闭环复扫。**事实、论断强度、安全信息零损失**：宁可留一点 AI 味，也不能改数字、改强度、删掉安全提示。

*A DeepSeek Harness plugin that strips AI-flavor from LLM text — local density scanning against human baselines, five-layer fact/strength/safety verification, and a closed-loop rescan. Facts, hedging strength, and safety notes are never lost.*

> 不是让 AI 装人，而是删掉 AI 那些不携带信息的习惯。删掉套话和总结段之后，剩下的就是人味。

---

## 安装（DeepSeek Harness）

**使用提示词（粘贴即用）**：[PROMPT.md](PROMPT.md) —— 一段主提示词驱动「扫描 → 改写 → 验收 → 自动回退」闭环，另附一句话版 / 写作前置版 / 英文版。
**上架市场**：[market/LISTING-KIT.md](market/LISTING-KIT.md) —— dsh-market + GitHub 三步执行包（含现成 PR 文案与安装验证记录）。

```bash
# 从 npm（发布后）
dsh plugin --profile demo add dsh-plugin-optimize-ai-reply

# 从 GitHub（无需 npm 发布）
dsh plugin --profile demo add github:your-github-id/dsh-plugin-optimize-ai-reply

# 本地目录 / 预构建 tarball（Release 页可下载 dsh-plugin-optimize-ai-reply.tgz）
dsh plugin --profile demo add ./optimize-ai-reply
dsh plugin --profile demo add ./dsh-plugin-optimize-ai-reply.tgz
```

或在 DSH 里打开 **Plugins → Discover**（需启用实验特性 *Custom plugin markets*），从市场索引一键安装（见 [market/README.md](market/README.md)）。
安装后 `dsh --profile demo --dump-config` 应看到 `# == dsh-plugin-optimize-ai-reply` 层。

## 7 个工具 = L0–L6 流水线

| 工具 | 层 | 作用 |
|---|---|---|
| `optimize_reply_scan` | **L2** | 本地扫描：每项特征的 命中数/密度/人类基线/AI 基线/倍率/判断（正常·观察项·偏高·高）。零网络、纯统计 |
| `optimize_reply_brief` | **L3** | 生成改写任务书：五条硬约束 + 本次命中清单 + 输出格式（提示词 B），**由你（模型）执行改写** |
| `optimize_reply_verify` | **L4** | 五层校验：事实（数字/URL/代码/引文/专名）· 强度与主次 · 安全信息 · 结构，任一违规即 fail |
| `optimize_reply_rescan` | **L5** | 闭环复扫：密度必须下降、不得引入新偏高项（「把破折号换成说白了」会被拦下） |
| `optimize_reply_check` | **L4+L5** | 一站式验收：返回 `accept` 或 `revert` 及原因（推荐改写后必调） |
| `optimize_reply_style_prompt` | **L1** | 生成侧提示词 A：写新内容前采用，从源头少写 AI 味 |
| `optimize_reply_rulecheck` | 维护 | 内置回归语料（40 真人 + 20 AI）逐规则误报率/检出率/建议 |

**标准工作流**（工具描述里已引导模型按此执行）：

```
optimize_reply_scan(text)                    → 有偏高/高项？
  ├─ 无 → 保持原文，结束
  └─ 有 → optimize_reply_brief(text) → 模型按任务书改写
           → optimize_reply_check(before, after)
                ├─ accept → 输出终稿
                └─ revert → 原样回退原文并说明原因（绝不交付更差文本）
```

改写不经过任何第三方「AI 检测器」API；扫描全程本地零网络；不让模型给文本打「AI 味分数」（用密度对照人类基线代替）。

## 配置

在 profile 的 `cordis.patch.yml` 里按行 id 覆盖（无需改包）：

```yaml
- id: optimize-ai-reply
  name: dsh-plugin-optimize-ai-reply
  config:
    defaultRegister: qa          # qa|social|script|popular|formal|academic（文体分档）
    defaultModel: unknown        # gpt|claude|deepseek|gemini|kimi|qwen|doubao|…
    thresholdMultiplier: 2       # 密度 ≥ 人类基线 × N 判「偏高」
    showWatchlist: true          # 是否输出【观察项】（命中未达阈值，默认不改）
    disabledRules: [A4]          # 单规则开关（rules.json 的 id）
```

配置实现 Standard Schema v1（[src/dsh/schema.js](src/dsh/schema.js)），非法值在插件装载期即报错。

## 双端收录（dsh-market + GitHub）

**给仓库打上 topic `dsh-plugin`（建议加 `dsh`、`deepseek-harness`）即完成大半**——社区市场每日自动扫描收录。完整三条路径（含给 `dshmarket` 精选列表的现成 PR 文件与 format 1 市场索引）见 **[market/README.md](market/README.md)**：

| 路径 | 动作 | 现成材料 |
|---|---|---|
| GitHub topic 自动收录 | 打 topic `dsh-plugin` | — |
| awesome-dsh-plugin（`dshmarket` 唯一数据源） | 提一个 YAML 的 PR | [market/awesome-dsh-plugin.yml](market/awesome-dsh-plugin.yml) |
| 市场索引（format 1） | 托管 index.json 或提交第三方市场 | [market/index.json](market/index.json)（生成器 [scripts/build-market-index.mjs](scripts/build-market-index.mjs)） |

打 tag 发布时 [Release 工作流](.github/workflows/release.yml) 自动上传 `dsh-plugin-optimize-ai-reply.tgz`（供 tarball 一键安装）、Chrome 扩展 zip，并在配置 `NPM_TOKEN` 后自动 `npm publish`。

## 上手示例

在 DSH 会话里直接说：

> 用 optimize_reply_scan 看看这段回答有哪些 AI 味特征；有偏高项就按 optimize_reply_brief 改写，然后用 optimize_reply_check 验收。

模型会自动走完 扫描 → 改写 → 验收 →（不过则回退）的闭环。工具输出的判断只有四档：正常 / 观察项 / 偏高 / 高——不给「AI 味总分」（模型自评分不可靠）。

## 验证（本仓库实测）

```bash
npm test          # 三套全跑
npm run test:dsh  # DSH 插件契约 20 项
```

| 测试 | 结果 |
|---|---|
| 单元测试（每条规则 1 正例 + 2 反例 + 引擎/五层校验/闭环/降级） | **125/125 通过** |
| 验收测试（规格 8 条：误报/检出/事实/强度/安全/闭环/时效/降级） | **11/11 通过**（真人误报 0/40 = 0%，AI 检出 20/20 = 100%） |
| DSH 插件契约（入口/Schema/7 工具/bundle/市场索引/提交文件） | **20/20 通过** |

## 规则库（54 条，数字全部有出处）

A 组中文 15 条 + 子规则 A3b、A 组英文 12 条（含 sloptells 实测子项）、B 组共识 16 条（命中+空泛双条件）、C 组禁止清单 10 条（不写检测器）。每条含证据等级、人类基线、AI 基线、倍率、适用文体/模型、as_of、保留边界、正例与 2 条反例。

- **判定**：密度 ≥ AI 基线 → 高；≥ 人类基线 × 2（可调）→ 偏高；命中未达阈值 → 观察项。稀有特征 1 次即标记，段落类 ≥3 次。
- **时效**：as_of 超 6 个月自动降级观察项；`optimize_reply_rulecheck` 输出逐规则误报率，>5% 不建议启用。
- **模型侧重**：Claude→空转引列表/顿号罗列；DeepSeek→破折号/长前置定语；GPT→翻案腔/rather than；Gemini→列表化/标题化。Kimi/Qwen/豆包/未知会注明「该模型无基线数据」。
- 被实测推翻/撤销的条目（A8 概括词、EN12 破折号等）保留原值并降为观察项，依据见 [docs/source-notes.md](docs/source-notes.md)。

数据来源：lieflat-less-ai-tone · chinese-de-ai-writing · Pangram · sloptells · CCL 2023 · HC3 · 少数派（详见 README 附录与 docs/source-notes.md 的逐项核对）。

## 已知局限与实现假设（保守解）

1. A12–A15 为 CCL 2023（GPT-3.5 时代）数据，有时代局限；三处「vs」方向已核对为「前者 AI、后者人类」。
2. A8 方向性结论被 lieflat 二轮配对复测推翻 → 只观察不改写；A5/A3b 限文体检测；EN12 破折号判 stale 只提示。
3. A13 双音节占比用书面词代理指标近似（无分词器）；A14 动词重复用常用动词表近似。
4. 强度层允许「整句删除无事实、无硬强度词」的豁免（否则删空总结必然触发校验失败）；同句对冲堆叠「留一个」有专门豁免。
5. 本插件改写法、不承诺过检测，不用对抗手段（C 组第 10 条）。

## 附带：Chrome MV3 扩展版

同一套核心（[src/core](src/core)）另有浏览器扩展形态：侧栏扫描（命中高亮 + 密度对比条）→ 改写 → diff → 回退/复制、内容脚本抓取、设置页。构建：`node build.mjs` → `dist/` 与 zip。demo 页 [demo/demo.html](demo/demo.html) 可脱离扩展直接体验本地扫描。

## 目录结构

```
├── index.js / index.mjs      DSH 插件入口（CJS + ESM 双导出）
├── cordis.patch.yml          dsh.bundle 配置层
├── src/dsh/                  工具层（7 工具）+ Standard Schema 配置
├── src/core/                 纯函数引擎：scan / verify / rewrite / rescan / rulecheck / prompts / rules.json
├── src/corpus/               回归语料：40 真人 + 20 AI
├── market/                   收录材料：市场索引/生成器/awesome 提交文件/指南
├── tests/                    125 单测 + 11 验收 + 20 DSH 契约
├── .github/workflows/        CI + Release（npm/tarball/zip 自动发布）
└── src/ui, manifest.json …   Chrome 扩展（副产品）
```

## License

MIT（[LICENSE](LICENSE)）。规则表中的统计数字归各数据源所有，按其开源许可引用。
