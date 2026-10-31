# 去 AI 味插件 · A 组基线数据源核对报告

- 调研日期：2026-10-31
- 调研方式：web_search / web_fetch 为主；GitHub 文件经 api.github.com contents API 获取；CCL 2023 论文经 PDF 镜像下载后解压内容流逐数字核对。找不到的项目一律标注「未找到 / 未能访问」，未编造任何数字。
- 用途：为 `rules.json` 的 human / ai 基线字段定值，并解决规格《去AI味插件-终极提示词-v2.md》A 组三处「A vs B」写法的方向歧义。

**三处歧义一句话结论（详见第 7 节）：**

1. **A12**：0.729 是 **AI（ChatGPT）**，0.251 是**人类**；「和」2.8× = AI 是人类的 2.8 倍。
2. **A13**：0.532 是 **AI**（双音节词占比），0.445 是**人类**；语气词密度**人类约 5× AI**（原文：ChatGPT 约为人类的五分之一）。
3. **A14**：0.437 是 **AI**，0.241 是**人类**。

---

## 1. lieflat-less-ai-tone（GitHub）——找到

来源：[larashero3-dotcom/lieflat-less-ai-tone](https://github.com/larashero3-dotcom/lieflat-less-ai-tone)，重点核对 [README.md](https://github.com/larashero3-dotcom/lieflat-less-ai-tone/blob/main/README.md) 与 [RESEARCH.md](https://github.com/larashero3-dotcom/lieflat-less-ai-tone/blob/main/RESEARCH.md)（文件经 GitHub contents API 下载原文核对）。

### 1.1 语料规模（与规格一致）

RESEARCH.md 语料表原文：

| | 篇 | 汉字 | 句 | 段 |
|---|---|---|---|---|
| AI | 300 | 1,179,105 | 37,642 | 14,549 |
| 人类 | 329 | 1,647,867 | 57,909 | 31,172 |
| 合计 | 629 | 2,826,972 | 95,551 | 45,721 |

- 模型：claude-opus-4-6、deepseek-v4-pro、gemini-3.1-pro、gpt-5.6-sol、kimi-k3，各 60 篇。
- 合计 2,826,972 汉字 ≈ **283 万汉字** ✓；「26 条判据只有 11 条通过」✓（另经 sspai 文章佐证）。

### 1.2 A8「人类数字密度是 AI 的 2.8×」原文口径（重点核对项）

RESEARCH.md「预设 vs 实测 → 成立」表原文行：

> | 材料密度（缺数字） | 未预设 | 数字 AI 6.34、人类 17.92 | 0.35×（人类多 2.8 倍） | 第 8 条 |

- **方向**：人类 17.92 > AI 6.34，「2.8×」= 人类是 AI 的 2.8 倍（17.92 ÷ 6.34 ≈ 2.83）；倍率列统一口径是「AI ÷ 人类」，故写 0.35×。
- **单位**：每千字（RESEARCH.md「分母」表：词汇/标点层特征用每千汉字）。
- **⚠ 重要限定（原文两处）**：① 第二轮 270 对配对复测「『AI 缺数字』的前提被推翻（配对后无差异）」，早期不配对口径下「AI 精确数字是人类 3 倍」同事实配对后 δ 归零（−0.06）；②「【2026-10-13 二次否决……规则 9 整条撤销，降 X 级】」。RESEARCH.md 判定节另注明：材料密度「方向明确，但『补数字』违反信息守恒原则……净零特征不进改写集」。
- 也就是说：**17.92 / 6.34 这组数是真实测得的第一轮（未配对）数字，可以填，但「AI 缺数字」作为方向性结论已被该仓库自己的配对复测推翻**，只剩「材料密度低时列【待补】」的提示用法（chinese-de-ai-writing 语义层检查第 4 条仍引用「人类文章的数字密度是 AI 的 2.8 倍」作提示）。

### 1.3 其余关键数字（供 rules.json 现有值核对，单位每千字，倍率=AI÷人类）

| 特征 | AI | 人类 | 倍率 | 备注 |
|---|---|---|---|---|
| 翻案腔（不是…而是） | 0.73 | 0.22 | 3.4× | detect.py 配对中位改用 0.22 / 0.94 |
| 段首零主语评论（占非首段） | 0.61% | 0.14% | 4.4× | 全场区分力最强 |
| 提示性冒号 | 0.29 | 0.08 | 3.8× | |
| 空转句引列表 | 0.29 | 0.03 | 9.4× | ⚠ 见 1.4 |
| 破折号 | 2.38 | 0.80 | 3.0× | 分模型：DeepSeek 5.16 / Claude 4.25 / Kimi 2.32 / Gemini 0.51 / GPT 0.11 |
| 起手式（说白了） | 0.025 | 0.008 | 3.2× | |
| 序数词当小标题 | 0.19 | 0.06 | 3.1× | ⚠ 见 1.4 |
| 相邻句结构同款（每百段） | 9.41 | 4.81 | 2.0× | 三连 2.03×（0.84 vs 0.41） |
| 拟人化喻体 | 0.018 | 0.002 | 7.3× | |
| 顿号罗列过密 | 3.21 | 1.78 | 1.8× | 配对复测密集并列 7.845 vs 5.398（1.45×） |
| 正文问句 | 0.10 | 1.83 | 0.05× | 人类是 AI 的 17 倍 |
| 比喻标记词 | 0.16 | 0.38 | 0.42× | 人类 2.4 倍 |
| 句长 CV | 0.58 | 0.67 | 0.87× | 无差异；配对轮 0.46 vs 0.54 |
| 动词名词化 | 0.003 | 0.005 | 0.52× | 人类更多 |

### 1.4 第二轮配对复测推翻的三条（v2 已删，但规格/部分条目仍在用旧值）

> | 序数词小标题 3.1× | AI 0.19 / 人类 0.06 | **反转**：人类 8.6% vs AI 4.9% |
> | 「这意味着」复述 2.6–5.3× | | **反向**：人类 0.027 vs AI 0.016/千字 |
> | 空转句引列表 9.4× | | **反向**：人类高一个量级（0.225 vs 0.008–0.032） |

即 **A5（序数词小标题）与 A3b（空转句引列表）的 0.06/0.19、0.03/0.29 是第一轮口径，lieflat 第二轮已分别反转/推翻**；但 chinese-de-ai-writing 的 HC3 检验里空转句引列表又是 Claude 检出主力（65% 触发，见第 2 节）——两者语体不同（问答 vs 目录式长文），需带文体限定。

### 1.5 三个歧义项在本仓库的覆盖情况

**未找到**。0.729 / 0.251 / 0.532 / 0.445 / 0.437 / 0.241 六个数字均不在 lieflat 仓库（全文件检索无命中）。A12–A14 的数字实际出自 CCL 2023 论文（见第 2、6 节），规格 A 组表头「来源：lieflat-less-ai-tone」只覆盖 A1–A11。

---

## 2. chinese-de-ai-writing（GitHub）——找到

来源：[tangwenwen-md/chinese-de-ai-writing](https://github.com/tangwenwen-md/chinese-de-ai-writing)，核对了 README.zh-CN.md、references/patterns.md、references/evidence.md、validation/RESULTS.md、scripts/zh_ai_scan.py。

### 2.1 三处歧义项的直接原文（references/patterns.md，数据源为 CCL 2023）

- **A12 并列列举**原文：
  > CCL 2023 数据：ChatGPT 句均并列短语 0.729，人类 0.251；"和"的使用频率约是人类的 2.8 倍。
- **A13 语气词/双音节**原文：
  > CCL 2023 测到 ChatGPT 语气词密度约为人类的五分之一，叹词几乎为零；双音节词占比 0.532（人类 0.445），单音节词少。
- **A14 相邻句重复**原文：
  > CCL 2023：ChatGPT 相邻句动词重复性 0.437，人类 0.241。
- A15 顺带：「CCL 2023：ChatGPT 段落数约为人类 2.5 倍，段落更短」；赵晰莹等 CCL 2025：加粗、序号等格式标记对检测模型影响显著。
- 语义层检查第 4 条：「人类文章的数字密度是 AI 的 2.8 倍。偏少时列【待补】，不要自己补。」（对应 A8 口径的二次引用）
- A13 另注：周濛 2024 小样本研究——商用「降 AI」软件刻意加模板化语气词，知网检出率反而上升（对应 C7）。

**→ 三处歧义的方向由此文件明确：三对数字都是「前者 ChatGPT/AI、后者人类」。**

### 2.2 HC3 检验结果（validation/RESULTS.md，2026-09-29）

| 组 | 文档数 | 任一实测项判为偏高 |
|---|---|---|
| human（HC3-Chinese 人类回答） | 12,078 | **3.4%**（误报率） |
| gpt35 | 5,803 | 18.9% |
| claude_qa（2026-09 版） | 60 | **85.0%** |
| claude_article（科普稿） | 12 | **83.3%** |

- 「Claude 检出 83–85%」✓、「人类误报 3.4%」✓（作者自注：阈值看过数据后调的，3.4% 偏乐观；第一轮 7.0%）。
- 分项触发率（Claude QA）：空转句引列表 65.0%、顿号罗列 37.5%、序数词小标题 20.0%、提示性冒号 10.0%、破折号 1.7%。
- 破折号随版本剧变：lieflat 旧版 Claude 4.25/千字 → 2026-05 稿件 7–8/千字 → 2026-09 版 0.1–0.6/千字。

### 2.3 规则判定阈值写法

- RESULTS.md 判定口径原文：「判为偏高」：任一实测特征**超过人类基线两倍**（人类基线低于 0.1/千字的稀有特征，出现 1 处即算；相邻句同构要求 3 处以上）。
- zh_ai_scan.py 的基线写法：`add_measured(name, hits, human, ai, unit="每千字", ...)`，输出字段直接叫「人类基线」「AI基线」；`rare = human < 0.1（每千字）`；命中门槛 `n >= min_n and rate >= human * 2`。基线成对出现，如翻案腔 `(0.22, 0.73)`、提示性冒号 `(0.08, 0.29)`、空转句 `(0.03, 0.29)`、起手式 `(0.008, 0.025)`、序数小标题 `(0.06, 0.19)`、拟人喻体 `(0.002, 0.018)`、段首零回指 `(0.14, 0.61)`。
- 语气词一条脚本注释给出粗略换算：「CCL 2023 估算人类问答约 9/千字、GPT-3.5 约 2/千字（按词密度换算，粗略）」——这是 A13 语气词唯一可填的绝对值，**属粗略估算而非论文原值**。

---

## 3. Pangram《9 Signs of AI Writing, Backed by Data》——找到（页面主体；末尾约 1/3 截断）

来源：[pangram.com/signs-of-ai-writing](https://www.pangram.com/signs-of-ai-writing)。以下为页面表格原文，单位**每万词**（Human per 10k words / AI per 10k words）：

| 信号 | 人类/万词 | AI/万词 | 倍率 |
|---|---|---|---|
| Markdown 标记 | 8 | 90 | 12× |
| AI 高频短语 | 3 | 30 | 12× |
| Em dashes | 2 | 17 | 10× |
| Bullet lists | 3 | 28 | 9× |
| Triads（三段排比） | 5 | 19 | 4× |
| Not just X but Y | 1 | 3 | 3× |
| Unusual Unicode | 28 | 71 | 3× |
| AI-style headers | 1 | 2 | 2× |
| Emojis | 0.1 | 0.2 | 2× |

Markdown 变体表（整句加粗 / 小标题的直接出处）：

| 变体 | 人类/万词 | AI/万词 | 倍率 |
|---|---|---|---|
| **Bold（\*\*text\*\*）** | **2** | **65** | **43×** |
| **Headers（#）** | **0.5** | **11** | **23×** |
| Inline code | 0.2 | 0.8 | 5× |
| Italic | 5 | 13 | 2× |

破折号按模型族：「Humans average **5** em dashes per 10,000 words」；OpenAI 45（9×）、Open Source 37（8×）、Anthropic 32（7×）、Google (Gemini 3 Pro) 3（0.7×）。**注意页面内部两个口径并存**：总表写 人类 2 / AI 17（10×），模型族节写人类基线 5/万词——规格第 86 行「5/万词 vs 17/万词」是混用两处，建议注明。

- 「句长变异系数 0.64–0.67 vs 0.52–0.57」：**未能在 Pangram 页确认**（抓取在 Unicode 表格处截断，多种代理均超时/失败）。该数字已在 sloptells 原文确认（见第 4 节），方向为**人类 CV 高、AI CV 低**。
- 页面其余（AI-style headers、Emojis 正文节）数字已被上表覆盖，无新增基线。

---

## 4. sloptells.com/tells.md（2026-10-30 生成）——找到

来源：[sloptells.com/tells.md](https://sloptells.com/tells.md) 全文 + [API /api/v1/tells](https://sloptells.com/api/v1/tells?status=active,saturated)（机器可读全量）+ [methodology](https://sloptells.com/methodology)。绝对频率取 run #19（2026-10-26 实测），单位**每万词**，pooled current AI vs humans (matched)：

| tell | AI/万词 | 人类/万词 | 倍率（源站标称） |
|---|---|---|---|
| rather than | 11.38 | 1.86 | ×6.1 |
| That said | 6.27 | 0.99 | ×6.3 |
| worth noting/mentioning | 2.94 | 0.37 | ×7.9 |
| in practice | 2.17 | 0.25 | ×8.7 |
| what (actually) matters | 1.24 | 0.12 | ×10.0 |
| the actual X | 2.48 | 0.99 | ×2.5 |
| one of those X | 3.48 | 0.12 | ×28 |
| genuinely | 5.96 | 0.37 | ×16 |
| (this) feels like | 3.02 | 0.37 | ×8.1 |
| the real question/problem is | 2.71 | 0 | 仅 AI（正文另称 7×） |
| therapist-mode vocabulary | 3.87 | 0.12 | ×31（3.87/0.12≈32，以源站 31× 为准） |
| not just X | 6.27 | 1.49 | ×4.2 |
| bold everywhere | 27.32 | 0 | 90×+（advice 语域） |
| bullets for a conversation | 33.59 | 6.46 | ×5.2（cooking 语域 134×） |

- 「genuinely 48 occurrences vs 1 in matched human text」等为原文表述；另「culinary 26 vs 1」「the privilege of：556 条人类评论 0 次」等绝对计数也在原文。
- **倍率口径提醒**：tells.md 正文与 run #19 表的倍率有几处不一致（That said 正文写 12×、feels like 正文 ~10×、one of those 正文 26×、the actual 正文 6×、what matters 正文 6×、in practice 正文 12×），规格采用的是 **run #19 的表倍率**（6.3/8.1/28/2.5/10/8.7），填 rules.json 建议以 run #19 为准并在 asOf 标 2026-10-26/30。

**em dash 判 stale 的原文**：

> ### the em dash (formatting, ×15 vs humans)
> The internet's favorite tell — "the ChatGPT dash" — and our headline negative result: acclaimed pre-AI human prose uses em dashes as much or more than current models do (0.67 vs 0.56 per 1k chars in our measurements). Accuse someone of being AI over an em dash and you will flag more good writers than models. Note: Kept public as history and as a caution: single formatting marks are terrible evidence. Density and co-occurrence are what count.

**delve / tapestry / a testament to 判 retired 的原文**：

> ### "delve" (lexical)
> The original. The word that launched a thousand detector threads in 2023–24. Absent from every current model we measure. Rest in peace. Note: Zero occurrences in our current-model corpora. Seeing it in fresh text suggests an old model, a cheap model, or a human joke.
>
> ### "tapestry" (lexical)
> "A rich tapestry of…" — 2023-era purple vocabulary, trained away alongside "delve". Not observed in current models.
>
> ### "a testament to" (construct, only in AI)
> Everything was a testament to something in 2023–24. Not observed in current models.

（同段 retired 还有「staccato mic-drop sentences」：连续短句已被推翻——「current models produce runs of short sentences *less* often than humans in every register we tested」。）

**句长 CV 原文**（uniform-sentences 条）：

> AI sentence-length variance is consistently below human (coefficient of variation ~0.52–0.57 vs ~0.64–0.67) in every register we measure.

→ **0.64–0.67 是人类、0.52–0.57 是 AI**（与中文 lieflat 的 0.67 人类 vs 0.58/0.46 AI 方向一致）。

---

## 5. sspai《我测了一遍中文"去 AI 味"的规则，一半是错的》——找到

来源：[sspai.com/post/115346](https://sspai.com/post/115346)（2026-10-04，唐文稳），全文已核对。

### 5.1 被推翻规则清单（原文要点）

- 「lieflat-less-ai-tone 的作者找了五个模型各写 60 篇，一共 300 篇，对照 329 篇人写的公开文章，总共 283 万字，把网上流传的 26 条判据挨个算了频率。站得住的只有 11 条。」
- 「句长均匀度人机没差别，早先『AI 均匀度是人的 51 倍』的说法，是程序把 Markdown 表格切成了一句话。」
- 「正文里的设问，人类用得是 AI 的 17 倍，比喻是 2.4 倍。倒是『说白了』开头的句子，AI 多用 3.2 倍。」
- 最强成立规则：段首零主语评论「AI 在这个位置的频率是人的 4.4 倍，改起来也简单，多数时候补一个字就行」（对应 A2）。
- 「很多改写示范在编造」：示例教模型「加入个人经历」「补充具体细节」，改完多出原文没有的数字、态度甚至虚构病例；两个大项目后来在更新日志承认并修复（对应 C9、硬约束 1）。
- HC3 验证数字与第 2 节一致（3.4% / 18.9% / 85% / 83%）；破折号「同一家的模型，隔几个月就差一个数量级……任何固定的『AI 词表』都会过时」。

### 5.2 C 组禁止清单 10 条出处核对

| C 组（rules.json） | 出处核对 | 结论 |
|---|---|---|
| C1 调句长、拆段制造参差 | sspai「句长均匀度人机没差别」+ lieflat 0.87×（0.58 vs 0.67） | ✓ 有出处 |
| C2 删设问/比喻/句内排比 | sspai「设问人类 17 倍、比喻 2.4 倍」+ lieflat 正文问句 0.05×、比喻 0.42×、句内排比 0.61×/0.95× | ✓ 有出处 |
| C3 名词化/被动一律改 | lieflat 动词名词化 0.52×（人类更多）、抽象被动 0.09 远低于门槛；zh-evidence 裁决表 | ✓ 有出处 |
| C4 四字格一律删 | zh-evidence：「四字格……没有中文频率数据」，不作为规则；sspai 未提及 | ⚠ 部分：属「无证据」而非「被实测推翻」 |
| C5 连接词一律删 | lieflat「首先，」2× 最弱、因果条件连词 AI 反而少（patterns.md A12 注意）；zh-evidence 裁决；英文维基「孤立连接词列为无效指标」（转引自 zh-evidence） | ✓ 有出处 |
| C6 按词表机械替换 | zh-evidence 词表裁决（shuorenhua v2.5 撤词表；Geng & Trotta 2025）；sspai 破折号段「任何固定的 AI 词表都会过时」 | ✓ 有出处 |
| C7 加口语词当人味 | lieflat「说白了」AI 0.025/人类 0.008（3.2×）；sspai 同数字；周濛 2024（硬塞语气词检出率反升） | ✓ 有出处 |
| C8 错别字/回译/同义词轮换 | zh-evidence 民间方法核查：NLPCC 2025 形近字攻击下最好检测器 F1 0.9943、CUDRT、掘金/shuorenhua 评测 | ✓ 有出处 |
| C9 编造细节/经历/数据/病例 | sspai「很多改写示范在编造」整节（最严重失败模式） | ✓ 有出处 |
| C10 以降低 AIGC 检测率为唯一目标 | zh-evidence：南京大学「检测结果只作辅助参考」、郑州商学院教务处汇总；redbaronyyyyy-eng 因此未采用 | ✓ 有出处 |

---

## 6. Wikipedia / arXiv / ACL（可选快扫）——部分找到

- **[Wikipedia:Signs of AI writing](https://en.wikipedia.org/wiki/Wikipedia:Signs_of_AI_writing)**：**未能直接访问**（en.wikipedia.org 从本网络多次 ECONNRESET/超时，移动版与 API 均失败）。仅经搜索摘要确认页面存在，摘要显示其内容为维基语境的 AI 文风指征（Markdown 星号加粗、`#` 标题、`---` 分隔线、三反引号代码块等），**未见可用的「每万词」基线数字** → 无可填数值。
- **[arXiv:2301.07597](https://arxiv.org/abs/2301.07597)**（Guo et al. 2023，HC3）：找到。摘要为定性结论（对比语料、评估、检测），**无每万词基线数字**。zh-evidence 转述其结论：情感更中性、困惑度更低、医学领域 AI 回答冗长。
- **[ACL 2023.ccl-1.46](https://aclanthology.org/2023.ccl-1.46/)**（朱君辉等《人工智能生成语言与人类语言对比研究——以ChatGPT为例》，159 项特征，HC3 中文开放域问答，GPT-3.5）：**这就是 A12–A15 数字的最上游出处**。除元数据与摘要外，另经 [PDF 镜像](https://tianlinyang.github.io/papers/ccl23_zjh.pdf) 解压内容流**逐数字核对**：
  - 表格中相邻两格 `0.251` 与 `0.729`（同一行，0.251 在前）；
  - 相邻两格 `0.445` 与 `0.532`（同一行，0.445 在前）；
  - 相邻两格 `0.241` 与 `0.437`（同一行，0.241 在前）。
  - 表头为 CID 字形无法直接转写，但列序（每对均为「小值在前、大值在后」）与 chinese-de-ai-writing 的标注（人类 0.251/0.445/0.241，ChatGPT 0.729/0.532/0.437）完全吻合。⚠ 时代局限（zh-evidence）：该批中文定量研究全部基于 GPT-3.5（2022 末–2023）。

---

## 7. 三个歧义项的明确结论

| 项 | 规格写法 | 结论 | 依据 |
|---|---|---|---|
| **A12 并列短语** | 「0.729 vs 0.251，"和" 2.8×」 | **0.729 是 AI（ChatGPT），0.251 是人类**；「和」2.8× = **AI 是人类的 2.8 倍**（仅倍率，无绝对值） | patterns.md 原文「ChatGPT 句均并列短语 0.729，人类 0.251」；CCL PDF 表格 0.251 在前列 |
| **A13 双音节/语气词** | 「0.532 vs 0.445」（语气词密度人类约 5×） | **0.532 是 AI（双音节占比），0.445 是人类**；语气词密度**人类 ≈ 5 × AI**（原文「ChatGPT 语气词密度约为人类的五分之一」） | patterns.md 原文「双音节词占比 0.532（人类 0.445）」；CCL PDF 表格 0.445 在前列 |
| **A14 动词重复** | 「0.437 vs 0.241」 | **0.437 是 AI，0.241 是人类**（相邻句动词重复性） | patterns.md 原文「ChatGPT 相邻句动词重复性 0.437，人类 0.241」；CCL PDF 表格 0.241 在前列 |
| （附）**A8 数字密度** | 「人类数字密度是 AI 的 2.8×」 | **人类 17.92/千字、AI 6.34/千字**，2.8× 是「人类 ÷ AI」（AI÷人类=0.35×）。⚠ 该方向性差异已被 lieflat 配对复测推翻，仅剩【待补】提示用法 | lieflat RESEARCH.md 原文行「数字 AI 6.34、人类 17.92 | 0.35×（人类多 2.8 倍）」 |

**统一规律：这三对数字都是「AI 值在前、人类值在后」的规格写法中，第一个数是 AI、第二个数是人类。**

---

## 8. 对 rules.json 的建议填法

原则：数字必须有出处；复合规则没有单一基线就留 null 并在备注写分项；被后续复测推翻的值要么带备注保留、要么降观察。

### 8.1 A 组（中文）

| id | 建议 human | 建议 ai | 理由 / 备注 |
|---|---|---|---|
| A1 | 0.22（保持） | 0.73（保持） | lieflat v1 原值；可注 detect.py 配对中位 0.22 / 0.94 |
| A2 | 0.14（保持） | 0.61（保持） | 单位是占非首段 %，与「每千字」不同，unit 字段注意 |
| A3 | 0.08（保持） | 0.29（保持） | lieflat 原值 |
| A3b | 0.03（保持） | 0.29（保持） | ⚠ 备注口径冲突：lieflat 配对复测反向（人类 0.225 vs AI 0.008–0.032），chinese-de-ai-writing HC3 中仍是检出主力（65%）；建议限问答/短文语体 |
| A4 | 0.8（保持） | 2.38（保持） | 备注分模型值（DeepSeek 5.16…GPT 0.11）与时效（2026-09 Claude 0.1–0.6/千字） |
| A5 | 0.06（保持） | 0.19（保持） | ⚠ 备注：lieflat 第二轮已反转（人类 8.6% vs AI 4.9%），建议降观察项 |
| A6 | 4.81（保持） | 9.41（保持） | 单位每百段 |
| A7 | 0.002（保持） | 0.018（保持） | |
| A8 | **17.92** | **6.34** | 出处真实（每千字）；**必须备注**「v1 未配对口径；v2 配对复测无差异（δ≈−0.06），规则已撤销，仅作【待补】提示」。若 schema 要求「可用于判定的基线」则留 null |
| A9 | 0.008（保持） | 0.025（保持） | |
| A10 | **null** | **null** | 只有 AI 子类绝对值（过长前置定语 0.42 / 当…时 0.26 / 话题壳 0.22 / 句首连接词 0.18 / 这意味着 0.15，每千字）与倍率 2.6–5.3×，无人类绝对值；子类值写进备注 |
| A11 | 1.78（保持） | 3.21（保持） | 条件规则 |
| A12 | **0.251** | **0.729** | 单位是**句均并列短语数**（非每千字），unit 需另标；「和」2.8× 只有倍率，可填 ratio，勿编绝对值 |
| A13 | **0.445**（双音节占比） | **0.532** | 占比口径。语气词子项建议 human/ai = **null**（或填 9 / 2 每千字并注明「zh_ai_scan.py 粗略换算，非论文原值」）；倍率 5× 可入 ratio |
| A14 | **0.241** | **0.437** | 相邻句动词重复性指标（无量纲），unit 另标 |
| A15 | **null** | **null** | 只有「段落数约人类 2.5×」（CCL 2023），ratio 可填 2.5；无人机绝对值。可注赵晰莹等 CCL 2025 |

### 8.2 E 组（英文）

| id | 建议 human | 建议 ai | 理由 / 备注 |
|---|---|---|---|
| E1 | 2（保持） | 65（保持） | Pangram 每万词（Bold 变体 43×）；unit 字段现为 en-char，建议核对为每万词 |
| E2 | 0.5（保持） | 11（保持） | Pangram（Headers 变体 23×）；同上 unit 核对 |
| E3 | 3（保持） | 30（保持） | Pangram；⚠ 正则里的 delve into / a testament to / tapestry of 已被 sloptells 判 retired（现行模型 0 命中），与规格「不要检测」冲突，建议移出或降为历史提示 |
| E4 | 3（保持） | 28（保持） | Pangram |
| E5 | 5（保持） | 19（保持） | Pangram |
| E6 | 1（保持） | 3（保持） | Pangram；sloptells「not just」口径 6.27/1.49（4.2×）不同源，勿混填 |
| E7 | **1.86** | **11.38** | sloptells run #19（2026-10-26，每万词，pooled）；ratio 6.1 ✓ |
| E8 | **null** | **null** | 复合规则，五项基线各异：That said 0.99/6.27、worth noting 0.37/2.94、in practice 0.25/2.17、what matters 0.12/1.24、the actual 0.99/2.48 → 分项写备注。顺带：advice 里「in practice 6.3×」是笔误，应为「That said 6.3×」 |
| E9 | **null** | **null** | 复合规则：one of those 0.12/3.48、genuinely 0.37/5.96、feels like 0.37/3.02、the real question is 0/2.71 → 分项写备注 |
| E10 | **0.12** | **3.87** | sloptells therapist-vocab（每万词）；标称 31×（3.87/0.12≈32，以源站为准） |
| E11 | 0.1（保持） | 0.2（保持） | Pangram emoji 口径；sloptells linkedin 口径 0/4.64 可写备注 |
| E12 | **null** | **null** | 区间值（人类 0.64–0.67、AI 0.52–0.57，sloptells 原文）无法填单数字段；区间写备注。metricOnly 保持，只展示不判定 ✓ |

### 8.3 B / C 组

- B1–B16：human / ai 全部**保持 null**（共识特征，无频率基线；「命中且空泛才改」双条件无法用密度基线表达）。
- C1–C10：**保持禁止清单文本，不填基线、不写检测器**（与规格「C 组只作为禁止清单文本」一致）。

### 8.4 全局注意事项

1. **A12–A15 的数据全部是 GPT-3.5 时代（CCL 2023）**，适用模型字段建议标 `legacy, gpt` 或加「时代局限」备注；新模型中文无大样本语言学统计（zh-evidence 明言）。
2. 所有 sloptells 数字统一标 asOf 2026-10-26（实测日）/2026-10-30（库生成日），该站明言「The list you're reading will be wrong in a year」。
3. Pangram 破折号 2/17（总表）与 5/万词（模型族节）两个口径并存，规格第 86 行混用，建议注明或择一。
4. 语义数字（0.729 等）若要与「每千字」扫描器同表展示，务必分列单位，避免量纲混排。
