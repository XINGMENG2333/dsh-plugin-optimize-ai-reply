/**
 * scan.js —— L2 本地扫描器（纯正则 + 统计，零网络、纯函数、可单测）
 * 输出每项特征的 命中数 / 密度 / 人类基线 / AI 基线 / 倍率 / 判断（正常·偏高·高·观察项）。
 * 判定统一用密度对照，不给规则拍脑袋权重。
 */
(function (root, factory) {
  var engine =
    (typeof module !== "undefined" && module.exports)
      ? require("./engine.js")
      : root.DeaiEngine;
  var api = factory(engine, root);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DeaiScan = api;
  }
})(typeof self !== "undefined" ? self : this, function (E, root) {
  "use strict";

  var MONTH_MS = 30 * 24 * 3600 * 1000;

  function getDefaultRules() {
    if (typeof module !== "undefined" && module.exports) {
      return require("./rules.json");
    }
    return root.DEAI_RULES || { rules: [] };
  }

  function compile(reSource, flags) {
    try {
      return new RegExp(reSource, flags || "gimu");
    } catch (err) {
      return null;
    }
  }

  // ---------- 通用：pattern 命中收集 ----------

  function patternHits(patterns, maskedText, originalText, skipIf) {
    var hits = [];
    for (var i = 0; i < (patterns || []).length; i++) {
      var re = compile(patterns[i], "gimu");
      if (!re) continue;
      var m;
      while ((m = re.exec(maskedText)) !== null) {
        if (m[0].length === 0) {
          re.lastIndex++;
          continue;
        }
        var span = {
          start: m.index,
          end: m.index + m[0].length,
          text: originalText.slice(m.index, m.index + m[0].length)
        };
        if (!skipHit(span, originalText, skipIf)) hits.push(span);
      }
    }
    hits.sort(function (a, b) {
      return a.start - b.start;
    });
    // 去重（同一位置多 pattern 命中只算一次）
    var out = [];
    for (var j = 0; j < hits.length; j++) {
      var prev = out[out.length - 1];
      if (prev && hits[j].start < prev.end) continue;
      out.push(hits[j]);
    }
    return out;
  }

  function skipHit(span, text, skipIf) {
    if (!skipIf || !skipIf.length) return false;
    var ctx = text.slice(Math.max(0, span.start - 12), Math.min(text.length, span.end + 12));
    for (var i = 0; i < skipIf.length; i++) {
      var re = compile(skipIf[i], "gimu");
      if (re && re.test(ctx)) return true;
    }
    return false;
  }

  // ---------- 空泛判定（B 组「命中 + 空泛」双条件） ----------

  var CONCRETE_RE = /\d|[A-Za-z]|《[^》]+》|医院|大学|学院|研究所|公司|指南|标准|规范|年|月|日|点|分|秒|岁|元|次|mg|ml|kg|km|%|：[^ ]{6,}/;

  function isVague(span, text) {
    // 以命中处所在句为判据：句内有任何具体信息（数字/专名/时间/引文/长冒号内容）就不空泛
    var before = text.slice(Math.max(0, span.start - 80), span.start);
    var after = text.slice(span.end, Math.min(text.length, span.end + 120));
    var sentenceStart = Math.max(before.lastIndexOf("。"), before.lastIndexOf("！"), before.lastIndexOf("？"), before.lastIndexOf("\n"));
    var sentenceEndRel = after.search(/[。！？\n]/);
    var sentence = text.slice(
      span.start - (sentenceStart >= 0 ? before.length - sentenceStart - 1 : before.length),
      span.end + (sentenceEndRel >= 0 ? sentenceEndRel + 1 : after.length)
    );
    return !CONCRETE_RE.test(sentence);
  }

  // ---------- 算法检测器 ----------

  var VERB_LEXICON = [
    "提升", "下降", "增加", "减少", "提高", "降低", "改善", "优化", "解决", "处理", "支持", "帮助",
    "需要", "要求", "保持", "改变", "产生", "发挥", "体现", "完成", "达到", "获得", "包含", "采用",
    "选择", "判断", "分析", "研究", "发展", "变化", "形成", "造成", "带来", "给出", "表示", "说明",
    "认为", "知道", "了解", "希望", "觉得", "使用", "实现", "进行", "提供", "出现", "影响", "导致",
    "检查", "安装", "配置", "启动", "重启", "备份", "恢复", "删除", "修改", "更新", "升级", "测试",
    "部署", "运行", "失败", "成功", "注意", "适合", "适用", "调整", "设置"
  ];

  var WRITTEN_WORDS = ["进行", "使用", "实现", "提供", "具有", "产生", "影响", "情况", "方面", "过程", "方法", "问题", "要求", "出现", "需要", "通过"];

  var SYNONYM_CLUSTERS = [
    ["患儿", "小患者", "孩子", "小朋友", "儿童"],
    ["患者", "病人", "病患", "病友"],
    ["该公司", "这家企业", "该机构", "这家公司"],
    ["用户", "使用者", "操作者", "终端用户"],
    ["这个方法", "该方法", "这一方法", "此方法"],
    ["这个方案", "该方案", "这一方案"]
  ];

  var ALGORITHMS = {
    /** A2 段首零回指评论：非首段段首评论词 + 首分句无回指 */
    paraAnaphoraless: function (text, ctx) {
      var hits = [];
      var paras = ctx.proseParagraphs;
      var openers = /^(关键在于|看起来|更重要的是|值得注意的是|需要指出的是|值得一提的是)/;
      for (var i = 1; i < paras.length; i++) {
        var t = paras[i].text.trim();
        var m = openers.exec(t);
        if (!m) continue;
        var firstClause = E.splitClauses(t)[0] || t.slice(0, 30);
        if (/[这那其它该]/.test(firstClause)) continue; // 已带回指
        if (/^(但|不过|所以|然而)/.test(t)) continue; // 承接词
        hits.push({ start: paras[i].start + (paras[i].text.indexOf(m[1])), end: paras[i].start + (paras[i].text.indexOf(m[1]) + m[1].length), text: m[1] });
      }
      return hits;
    },

    /** A3b 空转句引列表：空引导句 + 列表（无行动指令、无数字） */
    emptyIntroList: function (text, ctx) {
      var hits = [];
      var lines = String(text).split("\n");
      var pos = 0;
      var introRe = /(以下|如下|主要有|包括以下|可分为|分为|有以下|这几种|以下几种|以下几点|以下方面|以下情况)[^。\n]{0,16}[:：]\s*$/;
      var actionRe = /(任一|任一条|立刻|马上|立即|就医|拨打|120|急救|执行以下|按以下|操作步骤|点击|勾选|核对清单|对照表)/;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var start = pos;
        pos += line.length + 1;
        if (!introRe.test(line)) continue;
        if (actionRe.test(line)) continue;
        if (/\d|《/.test(line)) continue;
        // 后续非空行需为列表（≥2 项）
        var items = 0;
        for (var j = i + 1; j < lines.length && j <= i + 8; j++) {
          var t = lines[j].trim();
          if (t === "") continue;
          if (/^(?:[-*+•]|\d{1,2}[.、)]|[（(]\d{1,2}[)）])\s+\S/.test(lines[j])) {
            items++;
          } else {
            break;
          }
        }
        if (items >= 2) {
          hits.push({ start: start, end: start + line.length, text: line });
        }
      }
      return hits;
    },

    /** A5 序数词当小标题：连续 ≥3 的「一、二、三」短行 */
    ordinalHeadings: function (text, ctx) {
      var hits = [];
      var lines = String(text).split("\n");
      var pos = 0;
      var lineRe = /^\s*([一二三四五六七八九十])[、.．]\s*(\S.*)$/;
      var run = [];
      var runStart = [];
      function flush() {
        if (run.length >= 3) {
          for (var k = 0; k < run.length; k++) hits.push(run[k]);
        }
        run = [];
      }
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var start = pos;
        pos += line.length + 1;
        var m = lineRe.exec(line);
        if (m && m[2].length <= 30 && !/[。！？.!?]$/.test(m[2])) {
          run.push({ start: start + line.indexOf(m[1]), end: start + line.length, text: line.trim() });
          runStart.push(start);
        } else if (line.trim() === "") {
          // 空行不打断（小标题之间常有空行）
          continue;
        } else {
          flush();
        }
      }
      flush();
      return hits;
    },

    /** A6 相邻整句套同一骨架：同段相邻句对，逗号数相同（≥1）且长度档相同 */
    sameSkeleton: function (text, ctx) {
      var hits = [];
      var paras = ctx.proseParagraphs;
      for (var i = 0; i < paras.length; i++) {
        var sentences = E.splitSentences(paras[i].text, paras[i].start);
        for (var j = 0; j + 1 < sentences.length; j++) {
          var a = sentences[j].text;
          var b = sentences[j + 1].text;
          var ca = (a.match(/[，,]/g) || []).length;
          var cb = (b.match(/[，,]/g) || []).length;
          if (ca < 1 || ca !== cb) continue;
          var la = a.replace(/[。！？!?；;.\s]+$/, "").length;
          var lb = b.replace(/[。！？!?；;.\s]+$/, "").length;
          var band = function (n) {
            return n <= 20 ? 0 : n <= 40 ? 1 : n <= 80 ? 2 : 3;
          };
          if (band(la) === band(lb)) {
            hits.push({ start: sentences[j].start, end: sentences[j + 1].end, text: a + b });
          }
        }
      }
      return hits;
    },

    /** A8 概括词 + 同段有数字（只提示，judgment=watch） */
    vagueSummaryWithNumbers: function (text, ctx, patterns) {
      var hits = [];
      var paras = ctx.proseParagraphs;
      for (var i = 0; i < paras.length; i++) {
        var p = paras[i];
        if (!/\d/.test(p.text)) continue;
        var sub = patternHits(patterns, p.text, p.text, null);
        for (var j = 0; j < sub.length; j++) {
          hits.push({ start: p.start + sub[j].start, end: p.start + sub[j].end, text: sub[j].text });
        }
      }
      return hits;
    },

    /** A13 语气词缺失 + 书面词堆叠（观察项）：无语气词且书面词 ≥2 的句子 */
    registerTone: function (text, ctx) {
      var hits = [];
      var paras = ctx.proseParagraphs;
      for (var i = 0; i < paras.length; i++) {
        var sentences = E.splitSentences(paras[i].text, paras[i].start);
        for (var j = 0; j < sentences.length; j++) {
          var s = sentences[j].text;
          if (/[吧呢嘛啊呀哦哈呗啦]/.test(s)) continue;
          var n = 0;
          for (var k = 0; k < WRITTEN_WORDS.length; k++) {
            n += (s.split(WRITTEN_WORDS[k]).length - 1);
          }
          if (n >= 2 && E.countHanzi(s) >= 10) {
            hits.push({ start: sentences[j].start, end: sentences[j].end, text: s });
          }
        }
      }
      return hits;
    },

    /** A14 相邻句动词重复：相邻句对共享常用动词 */
    verbRepeat: function (text, ctx) {
      var hits = [];
      var pairs = 0;
      var paras = ctx.proseParagraphs;
      for (var i = 0; i < paras.length; i++) {
        var sentences = E.splitSentences(paras[i].text, paras[i].start);
        for (var j = 0; j + 1 < sentences.length; j++) {
          pairs++;
          var a = sentences[j].text;
          var b = sentences[j + 1].text;
          var shared = null;
          for (var k = 0; k < VERB_LEXICON.length; k++) {
            var v = VERB_LEXICON[k];
            if (a.indexOf(v) >= 0 && b.indexOf(v) >= 0) {
              shared = v;
              break;
            }
          }
          if (shared) {
            hits.push({ start: sentences[j].start, end: sentences[j + 1].end, text: shared });
          }
        }
      }
      ctx.opportunities = pairs;
      return hits;
    },

    /** A15 段落短碎：短段落数（观察项） */
    shortParagraphs: function (text, ctx) {
      var hits = [];
      var paras = ctx.proseParagraphs;
      for (var i = 0; i < paras.length; i++) {
        var t = paras[i].text.trim();
        if (t.length > 0 && t.length < 20 && E.countHanzi(t) >= 3) {
          hits.push({ start: paras[i].start, end: paras[i].end, text: t });
        }
      }
      return hits;
    },

    /** B10 对冲堆叠：同句 ≥2 个对冲词 */
    hedgeStack: function (text, ctx) {
      var hits = [];
      var paras = ctx.proseParagraphs;
      for (var i = 0; i < paras.length; i++) {
        var sentences = E.splitSentences(paras[i].text, paras[i].start);
        for (var j = 0; j < sentences.length; j++) {
          var s = sentences[j].text;
          var n = 0;
          for (var k = 0; k < E.HEDGE_ZH.length; k++) {
            n += s.split(E.HEDGE_ZH[k]).length - 1;
          }
          if (n >= 2) {
            hits.push({ start: sentences[j].start, end: sentences[j].end, text: s });
          }
        }
      }
      return hits;
    },

    /** B11 戏剧碎句：连续 ≥3 句且每句 ≤6 字（英文 ≤4 词） */
    dramaticFragments: function (text, ctx) {
      var hits = [];
      var paras = ctx.proseParagraphs;
      for (var i = 0; i < paras.length; i++) {
        var sentences = E.splitSentences(paras[i].text, paras[i].start);
        var run = [];
        function flushF() {
          if (run.length >= 3) {
            hits.push({ start: run[0].start, end: run[run.length - 1].end, text: run.map(function (s) { return s.text; }).join("") });
          }
          run = [];
        }
        for (var j = 0; j < sentences.length; j++) {
          var t = sentences[j].text.replace(/[。！？!?；;.\s]+$/, "");
          var isShort = E.countHanzi(t) > 0 ? E.countHanzi(t) <= 6 : E.countWords(t) <= 4;
          if (isShort && t.length > 0) {
            run.push(sentences[j]);
          } else {
            flushF();
          }
        }
        flushF();
      }
      return hits;
    },

    /** B12 同义词轮换：同一指称簇出现 ≥2 个不同成员 */
    synonymRotation: function (text, ctx) {
      var hits = [];
      for (var c = 0; c < SYNONYM_CLUSTERS.length; c++) {
        var cluster = SYNONYM_CLUSTERS[c];
        var found = [];
        for (var i = 0; i < cluster.length; i++) {
          var idx = text.indexOf(cluster[i]);
          if (idx >= 0) found.push({ word: cluster[i], start: idx, end: idx + cluster[i].length });
        }
        if (found.length >= 2) {
          hits.push({ start: found[1].start, end: found[1].end, text: found.map(function (f) { return f.word; }).join("/") });
        }
      }
      return hits;
    },

    /** B14 粗体装饰模板：「**关键词**：解释」且解释是成段文字 */
    decorativeTemplates: function (text, ctx, patterns) {
      var hits = [];
      var lines = String(text).split("\n");
      var pos = 0;
      var lineRe = /^\s*(?:[-*•]|\d{1,2}[.、])?\s*\*\*([^*\n]{2,12})\*\*\s*[:：]\s*(.*)$/;
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var start = pos;
        pos += line.length + 1;
        var m = lineRe.exec(line);
        if (!m) continue;
        var rest = (m[2] || "").trim();
        if (rest.length >= 8 || /[、，]/.test(rest)) {
          hits.push({ start: start, end: start + line.length, text: line.trim() });
        }
      }
      return hits;
    },

    /** EN4 项目符号列表滥用：句式列表项（≥4 词，且以句末标点结尾或 ≥6 词） */
    bulletAbuse: function (text, ctx) {
      var hits = [];
      var blocks = E.splitBlocks(text);
      for (var i = 0; i < blocks.length; i++) {
        if (blocks[i].type !== "listItem") continue;
        var t = blocks[i].text.replace(/^\s*(?:[-*+•]|\d{1,2}[.、)]|[（(]\d{1,2}[)）])\s+/, "").trim();
        var words = E.countWords(t);
        if (words >= 4 && (/[.!?]$/.test(t) || words >= 6)) {
          hits.push({ start: blocks[i].start, end: blocks[i].end, text: blocks[i].text.trim() });
        }
      }
      return hits;
    },

    /** EN5 三段排比：逗号切块 ≥3 且形态齐平（首块剥离主语+系动词） */
    triads: function (text, ctx) {
      var hits = [];
      var paras = ctx.proseParagraphs;
      for (var i = 0; i < paras.length; i++) {
        var sentences = E.splitSentences(paras[i].text, paras[i].start);
        for (var j = 0; j < sentences.length; j++) {
          var s = sentences[j].text;
          var chunksRaw = s.split(/[,，]/);
          if (chunksRaw.length < 3) continue;
          var chunks = [];
          var hadCopula = false;
          for (var c = 0; c < chunksRaw.length; c++) {
            var chunk = chunksRaw[c].replace(/^\s*(?:and|or|nor)\s+/i, "").trim();
            if (c === 0) {
              var cop = chunk.match(/\b(?:is|are|was|were|becomes?|feels?|seems?|sounds?|looks?|makes?)\b/i);
              if (cop) {
                hadCopula = true;
                chunk = chunk.slice(cop.index + cop[0].length).trim();
              }
            }
            chunks.push(chunk);
          }
          for (var k = 0; k + 2 <= chunks.length - 1; k++) {
            var win = chunks.slice(k, k + 3);
            var ok = true;
            var lens = [];
            for (var w = 0; w < win.length; w++) {
              var wc = E.countWords(win[w]);
              if (wc < 1 || wc > 8 || /^[\d\s.,%]+$/.test(win[w])) {
                ok = false;
                break;
              }
              lens.push(wc);
            }
            if (!ok) continue;
            var mn = Math.min.apply(null, lens);
            var mx = Math.max.apply(null, lens);
            if (mx - mn > 2) continue;
            var allSingle = lens.every(function (n) { return n === 1; });
            var allMulti = lens.every(function (n) { return n >= 2; });
            if (!allSingle && !allMulti) continue;
            if (allSingle && !hadCopula) continue; // 纯名词三项串（eggs, milk, bread）不算排比
            hits.push({ start: sentences[j].start, end: sentences[j].end, text: s.trim() });
            break;
          }
        }
      }
      return hits;
    },

    /** EN11 社媒模板：emoji 行首结构 */
    socialTemplates: function (text, ctx) {
      var hits = [];
      var lines = String(text).split("\n");
      var pos = 0;
      var emojiLines = [];
      for (var i = 0; i < lines.length; i++) {
        var line = lines[i];
        var start = pos;
        pos += line.length + 1;
        var m = E.EMOJI_RE.exec(line);
        E.EMOJI_RE.lastIndex = 0;
        if (m && m.index <= 2) {
          emojiLines.push({ start: start, end: start + line.length, text: line.trim() });
        }
      }
      if (emojiLines.length >= 2) return emojiLines;
      return [];
    }
  };

  // ---------- 密度与判定 ----------

  function densityOf(hits, unit, ctx) {
    var n = hits;
    switch (unit) {
      case "per1000zh":
        return ctx.hanzi > 0 ? (n / ctx.hanzi) * 1000 : 0;
      case "per10kwords":
        return ctx.words > 0 ? (n / ctx.words) * 10000 : 0;
      case "percent":
        return ctx.nonFirstParagraphs > 0 ? (n / ctx.nonFirstParagraphs) * 100 : 0;
      case "per100para":
        return ctx.paragraphs > 0 ? (n / ctx.paragraphs) * 100 : 0;
      case "perSentence":
        return ctx.sentences > 0 ? n / ctx.sentences : 0;
      case "rate":
        return ctx.opportunities > 0 ? n / ctx.opportunities : 0;
      case "count":
      default:
        return n;
    }
  }

  function isRare(human, unit) {
    if (human === null || human === undefined) return false;
    if (unit === "percent") return human < 0.2;
    if (unit === "per10kwords") return human < 0.5;
    return human < 0.1;
  }

  function deriveMinHits(target, unit) {
    if (target.minHits !== undefined && target.minHits !== null) return target.minHits;
    if (isRare(target.human, unit)) return 1;
    if (unit === "per100para" || unit === "percent") return 3;
    return 2;
  }

  function isStale(target, now) {
    var asOf = target.recheckOn || target.asOf;
    if (!asOf) return false;
    var t = Date.parse(asOf);
    if (isNaN(t)) return false;
    return now - t > 6 * MONTH_MS;
  }

  function judge(density, hits, minHits, human, ai, mode, stacked, threshold) {
    if (mode === "watch") return hits > 0 ? "watch" : "normal";
    if (mode === "double") return hits > 0 ? "elevated" : "normal"; // vague 过滤在上层处理
    if (mode === "stack") return stacked ? "elevated" : hits > 0 ? "watch" : "normal";
    if (hits < minHits) return hits > 0 ? "watch" : "normal";
    if (ai !== null && ai !== undefined && density >= ai) return "high";
    if (human !== null && human !== undefined && density >= human * (threshold || 2)) return "elevated";
    return hits > 0 ? "watch" : "normal";
  }

  // ---------- 主入口 ----------

  /**
   * scan(text, register, model, rules?) -> { stats[], watchlist[], format{}, meta{} }
   */
  function scan(text, register, model, rules, options) {
    rules = rules || getDefaultRules();
    register = register || "qa";
    model = model || "unknown";
    var threshold = (options && options.thresholdMultiplier) || 2;
    var now = Date.now();
    var s = String(text || "");

    var hanzi = E.countHanzi(s);
    var words = E.countWords(s);
    var blocks = E.splitBlocks(s);
    var prose = [];
    // 合并连续 para 行为一个段落
    var cur = null;
    for (var bi = 0; bi < blocks.length; bi++) {
      var b = blocks[bi];
      if (b.type === "para" && b.text.trim()) {
        if (!cur) {
          cur = { type: "para", start: b.start, end: b.end, text: b.text };
        } else {
          cur.end = b.end;
          cur.text += "\n" + b.text;
        }
      } else {
        if (cur) prose.push(cur);
        cur = null;
      }
    }
    if (cur) prose.push(cur);
    var listItems = blocks.filter(function (b) {
      return b.type === "listItem";
    });
    var headings = blocks.filter(function (b) {
      return b.type === "heading";
    });

    var sentenceCount = 0;
    for (var pi = 0; pi < prose.length; pi++) {
      sentenceCount += E.splitSentences(prose[pi].text, 0).length;
    }

    var ctx = {
      proseParagraphs: prose,
      paragraphs: prose.length + listItems.length,
      nonFirstParagraphs: Math.max(0, prose.length - 1),
      sentences: Math.max(1, sentenceCount),
      hanzi: hanzi,
      words: words,
      opportunities: 0
    };

    var sentenceMask = E.maskZones(s, "sentence");
    var lineMask = E.maskZones(s, "line");

    var modelInfo = (rules.models || {})[model] || (rules.models || {})["unknown"] || {};
    var focusIds = modelInfo.focus || [];

    var stats = [];
    var staleDowngraded = [];

    function runTarget(rule, target, isVariant, precomputed) {
      if (target.enabled === false) return;
      if (target.evidenceStatus === "disabled") return;
      // 文体过滤（variant 可覆盖）
      var regs = target.registers || rule.registers || ["qa", "social", "script", "popular", "formal", "academic"];
      if (regs.indexOf(register) < 0) return;
      // 模型过滤
      var mods = target.models || rule.models || ["all"];
      if (mods.indexOf("all") < 0 && mods.indexOf(model) < 0) return;

      var unit = target.unit || rule.unit || "per1000zh";
      var mode = rule.judgment || "density";
      if (rule.type === "text") return; // C 组禁止清单：不写检测器

      var patterns = target.patterns || rule.patterns || [];
      // 算法规则自带 pattern 处理时不重复做顶层扫描（防双计）
      var algoName = target.hasOwnProperty("algorithm") ? target.algorithm : isVariant ? null : rule.algorithm;
      var algoTakesPatterns = algoName && ALGORITHMS[algoName] && (rule.type === "algorithm" || target.algorithm) && rule.patternScan !== true;
      var useLineMask = (target.maskLevel || rule.maskLevel) === "line";

      ctx.opportunities = 0;
      var hits = [];
      if (patterns.length && !algoTakesPatterns) {
        hits = patternHits(patterns, useLineMask ? lineMask : sentenceMask, s, rule.skipIf || target.skipIf);
      }
      if (algoName && ALGORITHMS[algoName]) {
        var algoHits = ALGORITHMS[algoName](s, ctx, patterns);
        hits = hits.concat(algoHits);
      }
      // 合并去重（同起点只算一次）
      hits.sort(function (a, b) {
        return a.start - b.start || b.end - a.end;
      });
      var deduped = [];
      for (var di = 0; di < hits.length; di++) {
        var prevHit = deduped[deduped.length - 1];
        if (prevHit && hits[di].start === prevHit.start && hits[di].end === prevHit.end) continue;
        if (prevHit && hits[di].start < prevHit.end) continue;
        deduped.push(hits[di]);
      }
      hits = deduped;

      var density = densityOf(hits.length, unit, ctx);
      if (unit === "rate" && algoName === "verbRepeat") {
        density = ctx.opportunities > 0 ? hits.length / ctx.opportunities : 0;
      }

      // B 组空泛过滤
      var vagueHits = [];
      if (mode === "double") {
        var needVague = target.vagueRequired !== undefined ? target.vagueRequired : rule.vagueRequired !== false;
        if (needVague) {
          vagueHits = hits.filter(function (h) {
            return isVague(h, s);
          });
        } else {
          vagueHits = hits.slice();
        }
        if (rule.skipIf || target.skipIf) {
          vagueHits = vagueHits.filter(function (h) {
            return !skipHit(h, s, rule.skipIf || target.skipIf);
          });
        }
      }

      // 堆叠（A10）：同一段 ≥2 个计入命中的子项（disputed/watchOnly 子项不计）；跨子项合并计算
      var stacked = false;
      if (mode === "stack") {
        stacked = precomputed && precomputed.stacked ? true : false;
      }

      var minHits = deriveMinHits(target, unit);
      var stale = isStale(target, now) || isStale(rule, now);
      var level;
      if (target.watchOnly) {
        level = hits.length > 0 ? "watch" : "normal";
      } else if (stale && mode !== "watch") {
        level = hits.length > 0 ? "watch" : "normal";
        staleDowngraded.push(target.id || rule.id);
      } else if (mode === "double") {
        level = vagueHits.length >= 1 && hits.length >= 1 ? "elevated" : hits.length > 0 ? "watch" : "normal";
      } else {
        level = judge(density, hits.length, minHits, target.human !== undefined ? target.human : rule.human, target.ai !== undefined ? target.ai : rule.ai, mode, stacked, threshold);
      }

      stats.push({
        id: rule.id,
        variantId: isVariant ? target.id : undefined,
        name: rule.name + (isVariant ? " · " + target.name : ""),
        group: rule.group,
        evidenceLevel: rule.evidenceLevel,
        evidenceStatus: target.evidenceStatus || rule.evidenceStatus || "ok",
        hits: hits.length,
        density: E.round(density, 3),
        human: target.human !== undefined ? target.human : rule.human,
        ai: target.ai !== undefined ? target.ai : rule.ai,
        ratio: target.ratio !== undefined ? target.ratio : rule.ratio,
        ratioNote: target.ratioNote || rule.ratioNote,
        unit: unit,
        level: level,
        minHits: minHits,
        conditional: !!rule.conditional,
        focus: focusIds.indexOf(rule.id) >= 0,
        stale: stale,
        spans: hits.slice(0, 50),
        advice: rule.advice || "",
        boundary: rule.boundary || "",
        fixMode: rule.fixMode || "rewrite"
      });
    }

    var ruleList = rules.rules || [];
    for (var ri = 0; ri < ruleList.length; ri++) {
      var rule = ruleList[ri];
      if (rule.type === "text") continue;
      if (rule.enabled === false) continue;
      var useVariants =
        rule.variants &&
        rule.variants.length &&
        (rule.variants.some(function (v) {
          return v.human !== undefined || v.ai !== undefined;
        }) ||
          rule.judgment === "double");
      if (useVariants) {
        // A10 堆叠需要跨子项合并计算（disputed/watchOnly 子项不计）
        var pre = null;
        if (rule.judgment === "stack") {
          var perPara = {};
          for (var vk = 0; vk < rule.variants.length; vk++) {
            var vt = rule.variants[vk];
            if (vt.watchOnly || vt.evidenceStatus === "disputed") continue;
            var vPat = vt.patterns || [];
            if (!vPat.length) continue;
            var vHits = patternHits(vPat, sentenceMask, s, rule.skipIf);
            for (var vh = 0; vh < vHits.length; vh++) {
              for (var pj = 0; pj < prose.length; pj++) {
                if (vHits[vh].start >= prose[pj].start && vHits[vh].start < prose[pj].end) {
                  perPara[pj] = (perPara[pj] || 0) + 1;
                }
              }
            }
          }
          var anyStack = false;
          for (var pk in perPara) {
            if (perPara[pk] >= 2) anyStack = true;
          }
          pre = { stacked: anyStack };
        }
        for (var vi = 0; vi < rule.variants.length; vi++) {
          runTarget(rule, rule.variants[vi], true, pre);
        }
      } else {
        runTarget(rule, rule, false, null);
      }
    }

    var watchlist = stats
      .filter(function (x) {
        return x.level === "watch";
      })
      .map(function (x) {
        return {
          id: x.id,
          variantId: x.variantId,
          name: x.name,
          hits: x.hits,
          density: x.density,
          note: "命中但未达阈值（或规则已过期/被推翻），默认不改",
          spans: x.spans.slice(0, 5)
        };
      });

    // ---------- format 指标（只展示不判定） ----------
    var boldAll = (s.match(/\*\*[^*\n]{2,}\*\*/g) || []).length;
    var boldFull = (s.match(/\*\*[^*\n]{15,}\*\*/g) || []).length;
    var emojiCount = E.countEmoji(s);
    var totalLines = s.split("\n").length;
    var listLineCount = (s.match(/^[ \t]*(?:[-*+•]|\d{1,2}[.、)])\s+\S/gm) || []).length;
    var paraLens = prose.map(function (p) {
      return p.text.trim().length;
    });
    var sentenceLens = [];
    for (var si = 0; si < prose.length; si++) {
      var ss = E.splitSentences(prose[si].text, 0);
      for (var sj = 0; sj < ss.length; sj++) sentenceLens.push(ss[sj].text.length);
    }
    var particleCount = (s.match(/[吧呢嘛啊呀哦哈呗啦]/g) || []).length;

    var format = {
      boldCount: boldAll,
      boldFullSentenceCount: boldFull,
      emojiCount: emojiCount,
      headingCount: headings.length,
      listLineCount: listLineCount,
      listLineRatio: totalLines > 0 ? E.round(listLineCount / totalLines, 3) : 0,
      paragraphCount: ctx.paragraphs,
      paragraphLenCV: E.round(E.coefficientOfVariation(paraLens), 3),
      sentenceLenCV: E.round(E.coefficientOfVariation(sentenceLens), 3),
      modalParticleDensity: hanzi > 0 ? E.round((particleCount / hanzi) * 1000, 3) : 0,
      writtenWordDensity: hanzi > 0 ? E.round(((s.match(new RegExp(WRITTEN_WORDS.join("|"), "g")) || []).length / hanzi) * 1000, 3) : 0
    };

    var meta = {
      register: register,
      model: model,
      modelName: modelInfo.name || model,
      modelHasBaseline: modelInfo.hasBaseline !== false,
      modelNote: modelInfo.hasBaseline === false ? "该模型无基线数据：" + (modelInfo.note || "") : modelInfo.note || "",
      rulesVersion: rules.version,
      rulesAsOf: rules.asOf,
      hanzi: hanzi,
      words: words,
      sentences: ctx.sentences,
      paragraphs: ctx.paragraphs,
      generatedAt: new Date(now).toISOString(),
      staleDowngraded: staleDowngraded,
      focusRules: focusIds
    };

    return { stats: stats, watchlist: watchlist, format: format, meta: meta };
  }

  /** 便捷：文档级判断（验收测试用）——存在任一 偏高/高 即视为「偏高文档」 */
  function documentFlag(result) {
    var elevated = result.stats.filter(function (x) {
      return x.level === "elevated" || x.level === "high";
    });
    return { flagged: elevated.length > 0, elevated: elevated };
  }

  return {
    scan: scan,
    documentFlag: documentFlag,
    isVague: isVague,
    isStale: isStale,
    ALGORITHMS: ALGORITHMS,
    getDefaultRules: getDefaultRules
  };
});
