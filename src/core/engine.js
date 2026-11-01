/**
 * engine.js —— 优化 AI 回复插件核心工具层（L0/L2 共用）
 * 纯函数、无网络、可单测；浏览器（经典 script）与 Node（CommonJS）双环境。
 * 职责：跳过区遮罩、分段/分句、密度分母、事实抽取、通用文本工具。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DeaiEngine = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---------- 基础工具 ----------

  function escapeRegex(s) {
    return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function round(n, digits) {
    if (n === null || n === undefined || !isFinite(n)) return n;
    var f = Math.pow(10, digits === undefined ? 2 : digits);
    return Math.round(n * f) / f;
  }

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  // ---------- 遮罩与跳过区 ----------
  // 跳过区（规格）：代码块、行内代码、表格、公式、引用块、URL、HTML、列表行（句层不数）、标题行（标题单独判）。
  // 遮罩用同长度占位符替换，保证所有正则偏移与原文对齐。

  var FENCE_RE = /^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t]*(?:```|~~~)[ \t]*$|\Z)/gm;
  var INLINE_CODE_RE = /`[^`\n]+`/g;
  var FORMULA_BLOCK_RE = /\$\$[\s\S]+?\$\$/g;
  var FORMULA_INLINE_RE = /(?<![\w\\])\$[^\$\n]{1,80}\$/g;
  var TABLE_RE = /^[ \t]*\|?[^\n|]*\|[^\n]*$/gm;
  var QUOTE_RE = /^[ \t]*>[^\n]*$/gm;
  var URL_RE = /https?:\/\/[^\s)\]}>"'`<>，。；]+/g;
  var HTML_RE = /<\/?[A-Za-z][A-Za-z0-9-]*(?:\s+[^<>]*?)?\/?>/g;
  var LIST_LINE_RE = /^[ \t]*(?:[-*+•]|\d{1,2}[.、)]|[（(]\d{1,2}[)）])\s+\S[^\n]*$/gm;
  var HEADING_LINE_RE = /^[ \t]{0,3}#{1,6}[ \t]+\S[^\n]*$/gm;

  function maskWith(masked, re, ch) {
    return masked.replace(re, function (m) {
      return new Array(m.length + 1).join(ch || "\uE000");
    });
  }

  /**
   * 生成遮罩文本。
   * level = "sentence"：句层特征用，列表行与标题行也遮罩；
   * level = "line"   ：行层特征用（A5/EN2/加粗/模板行），保留列表行与标题行。
   */
  function maskZones(text, level) {
    var masked = String(text);
    masked = maskWith(masked, FENCE_RE);
    masked = maskWith(masked, INLINE_CODE_RE);
    masked = maskWith(masked, FORMULA_BLOCK_RE);
    masked = maskWith(masked, FORMULA_INLINE_RE);
    masked = maskWith(masked, URL_RE);
    masked = maskWith(masked, HTML_RE);
    masked = maskWith(masked, TABLE_RE);
    masked = maskWith(masked, QUOTE_RE);
    if (level !== "line") {
      masked = maskWith(masked, LIST_LINE_RE);
      masked = maskWith(masked, HEADING_LINE_RE);
    }
    return masked;
  }

  // ---------- 分段（块级） ----------

  /**
   * 把文本切成块。返回 [{type, start, end, text}]
   * type: code | table | quote | formula | heading | listItem | html | para | blank
   */
  function splitBlocks(text) {
    var s = String(text);
    var blocks = [];
    var lines = s.split("\n");
    var pos = 0;
    var i = 0;
    while (i < lines.length) {
      var line = lines[i];
      var start = pos;
      var end = pos + line.length;
      var t = line.trim();
      var type = "para";
      if (t === "") {
        type = "blank";
      } else if (/^(?:```|~~~)/.test(t)) {
        type = "code";
        // 代码块整体成块
        var j = i + 1;
        while (j < lines.length && !/^(?:```|~~~)/.test(lines[j].trim())) j++;
        end = pos;
        for (var k = i; k <= Math.min(j, lines.length - 1); k++) end += lines[k].length + 1;
        blocks.push({ type: "code", start: start, end: end, text: s.slice(start, end) });
        pos = end;
        i = j + 1;
        continue;
      } else if (/^\s*\|/.test(line) || /^\s*[^|]*\|[^|]*\|/.test(line)) {
        type = "table";
      } else if (/^\s*>/.test(line)) {
        type = "quote";
      } else if (/^\$\$/.test(t)) {
        type = "formula";
      } else if (/^\s{0,3}#{1,6}\s/.test(line)) {
        type = "heading";
      } else if (/^\s*(?:[-*+•]|\d{1,2}[.、)]|[（(]\d{1,2}[)）])\s+\S/.test(line)) {
        type = "listItem";
      } else if (/^\s*<\/?[A-Za-z]/.test(line)) {
        type = "html";
      }
      blocks.push({ type: type, start: start, end: end + 1, text: line });
      pos = end + 1;
      i++;
    }
    return blocks;
  }

  /** 纯文字段落（para）：非空、非列表、非标题、非代码/表格/引用/公式。 */
  function proseParagraphs(text) {
    return splitBlocks(text).filter(function (b) {
      return b.type === "para" && b.text.trim().length > 0;
    });
  }

  // ---------- 分句 ----------

  // 英文缩写与小数保护
  var ABBREV = ["e.g.", "i.e.", "etc.", "vs.", "Mr.", "Mrs.", "Ms.", "Dr.", "Prof.", "No.", "U.S.", "U.K.", "a.m.", "p.m."];

  /**
   * 句子切分（中英混排）。返回 [{text, start, end}]（含句末标点）。
   */
  function splitSentences(paraText, baseOffset) {
    var s = String(paraText);
    var out = [];
    var start = 0;
    var re = /([。！？!?；;])|(\.(?=\s|$))/g;
    var m;
    while ((m = re.exec(s)) !== null) {
      var idx = m.index;
      var punct = m[0];
      // 小数/缩写保护
      if (punct === ".") {
        var before = s.slice(Math.max(0, idx - 4), idx + 1);
        if (/\d\.$/.test(before)) continue; // 3.
        var tail = s.slice(idx - 5, idx + 1).toLowerCase();
        var isAbbrev = ABBREV.some(function (a) {
          return tail.slice(-a.length) === a.toLowerCase();
        });
        if (isAbbrev) continue;
      }
      var end = idx + 1;
      var piece = s.slice(start, end);
      if (piece.trim().length > 0) {
        out.push({ text: piece, start: (baseOffset || 0) + start, end: (baseOffset || 0) + end });
      }
      start = end;
    }
    if (start < s.length && s.slice(start).trim().length > 0) {
      out.push({ text: s.slice(start), start: (baseOffset || 0) + start, end: (baseOffset || 0) + s.length });
    }
    return out;
  }

  /** 句内小分句（逗号/顿号/分号级），用于空泛判定与对冲堆叠。 */
  function splitClauses(sentence) {
    return String(sentence)
      .split(/[，,、；;：:]/)
      .map(function (c) {
        return c.trim();
      })
      .filter(function (c) {
        return c.length > 0;
      });
  }

  // ---------- 密度分母 ----------

  function countHanzi(text) {
    var m = String(text).match(/[\u4e00-\u9fff]/g);
    return m ? m.length : 0;
  }

  function countWords(text) {
    // 英文词数：字母词（含 's）与数字串各算一词
    var m = String(text).match(/[A-Za-z]+(?:['’][A-Za-z]+)?|\d+(?:[.:]\d+)*/g);
    return m ? m.length : 0;
  }

  // ---------- 统计 ----------

  function mean(arr) {
    if (!arr.length) return 0;
    var sum = 0;
    for (var i = 0; i < arr.length; i++) sum += arr[i];
    return sum / arr.length;
  }

  function stdDev(arr) {
    if (arr.length < 2) return 0;
    var mu = mean(arr);
    var v = 0;
    for (var i = 0; i < arr.length; i++) v += (arr[i] - mu) * (arr[i] - mu);
    return Math.sqrt(v / arr.length);
  }

  /** 变异系数 CV = σ/μ */
  function coefficientOfVariation(arr) {
    var mu = mean(arr);
    if (!mu) return 0;
    return stdDev(arr) / mu;
  }

  // ---------- emoji ----------

  var EMOJI_RE = /(?:[\u2190-\u21FF\u2300-\u23FF\u25A0-\u27BF\u2B00-\u2BFF\uFE0F]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF])(?:\uFE0F|\u200D(?:[\u2190-\u21FF\u2300-\u23FF\u25A0-\u27BF\u2B00-\u2BFF\uFE0F]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|\uD83E[\uDC00-\uDFFF]))*/g;

  function countEmoji(text) {
    var m = String(text).match(EMOJI_RE);
    return m ? m.length : 0;
  }

  // ---------- 事实抽取（verify 用） ----------

  // 数字 + 可选单位（含 %、计量、时间、货币）
  var NUM_UNIT_RE = /-?\d+(?:[.,]\d+)?(?:\s*(?:%|％|mg|ug|μg|ml|mL|l|L|g|kg|km|mm|cm|m|万|亿|千|次|天|小时|分钟|秒|年|月|日|周|星期|倍|px|pt|em|rem|dB|GB|MB|KB|TB|GHz|MHz|kHz|W|kW|V|A|mA|℃|°C|°F|磅|英寸|亩|公顷|人|例|名|位|岁|元|万元|美元|欧元|英镑|分|度|帧|ms|s|n|个|件|台|条|项|款|部|集|期|届|轮|版|级|层|步|页|字|行|列|组|批|份|家|所|座|辆|架|艘|场|局|盘|瓶|盒|片|粒|剂|针|支|双|对|套|栋|间|层))?(?![\d%A-Za-z])/g;

  function extractNumbers(text) {
    var m = String(text).match(NUM_UNIT_RE);
    return m ? m.map(normalizeNumberToken) : [];
  }

  function normalizeNumberToken(t) {
    return t.replace(/\s+/g, "").replace(/，/g, ",").toLowerCase();
  }

  function extractUrls(text) {
    var m = String(text).match(/https?:\/\/[^\s)\]}>"'`<>，。；]+/g);
    return m ? m.map(function (u) {
      return u.replace(/[.,;:]+$/, "");
    }) : [];
  }

  /** 代码块 + 行内代码的原始文本。 */
  function extractCode(text) {
    var out = [];
    var s = String(text);
    var fence = s.match(/^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t]*(?:```|~~~)[ \t]*$|$)/gm);
    if (fence) out = out.concat(fence.map(stripFence));
    var inline = s.match(/`[^`\n]+`/g);
    if (inline) out = out.concat(inline);
    return out;
  }

  function stripFence(block) {
    return String(block).replace(/^[ \t]*(?:```|~~~)[^\n]*\n?/, "").replace(/^[ \t]*(?:```|~~~)[ \t]*$/m, "").trim();
  }

  /** 公式：$$…$$ 与含运算符的 $…$。 */
  function extractFormulas(text) {
    var out = [];
    var s = String(text);
    var blocks = s.match(/\$\$[\s\S]+?\$\$/g);
    if (blocks) out = out.concat(blocks);
    var inline = s.match(/(?<![\w\\])\$[^\$\n]{1,80}\$/g) || [];
    for (var i = 0; i < inline.length; i++) {
      if (/[+\-*/^=_\\]/.test(inline[i])) out.push(inline[i]);
    }
    return out;
  }

  /** 引号内引文（中英）。 */
  function extractQuotes(text) {
    var out = [];
    var s = String(text);
    var pairs = [
      [/“([^”\n]{1,200})”/g, 1],
      [/「([^」\n]{1,200})」/g, 1],
      [/『([^』\n]{1,200})』/g, 1],
      [/"([^"\n]{1,200})"/g, 1],
      [/‘([^’\n]{1,200})’/g, 1]
    ];
    for (var i = 0; i < pairs.length; i++) {
      var re = pairs[i][0];
      var m;
      while ((m = re.exec(s)) !== null) {
        if (m[1] && m[1].trim().length >= 2) out.push(m[1].trim());
      }
    }
    return out;
  }

  /** 专名抽取：书名号、机构/药物后缀、英文大写序列。 */
  /** 机构名 = 2–10 个汉字前缀 + 机构后缀；下面是常见文言虚词/代词，出现即判定为普通行文而非机构名。 */
  var PROSE_CHARS = /[在是了的地与或对把被从向给让使而也都就还又很最更不没无这那其该我你他她它们此每某两几多少太第等有]/;

  /** 去掉机构名尾部常见法律形式，避免「有限/股份」里的虚词误伤。 */
  function stripLegalForm(prefix) {
    return prefix.replace(/(?:有限责任|股份有限|有限|责任|控股|实业)$/, "");
  }

  /**
   * 归一化专名前缀：先剥掉句首虚词与代词（"在北京协和" → "北京协和"），
   * 再排除仍是普通行文的前缀（"本季度我们在" → 空、"我们在" → 空）。
   * @returns 归一化后的名字前缀；不像专名时返回空串。
   */
  function normalizeNamePrefix(prefix) {
    var p = prefix;
    while (p.length && PROSE_CHARS.test(p.charAt(0))) p = p.slice(1);
    p = stripLegalForm(p);
    if (p.length < 2) return "";
    if (PROSE_CHARS.test(p)) return "";
    return p;
  }

  /** 按后缀抽取专名：只保留归一化后仍像名字的匹配。 */
  function matchContentNames(text, re, suffixRe) {
    var out = [];
    var matches = text.match(re) || [];
    for (var i = 0; i < matches.length; i++) {
      var sm = matches[i].match(suffixRe);
      if (!sm) continue;
      var suffix = sm[0];
      var prefix = matches[i].slice(0, matches[i].length - suffix.length);
      var name = normalizeNamePrefix(prefix);
      if (name) out.push(name + suffix);
    }
    return out;
  }

  function extractProperNouns(text) {
    var out = [];
    var s = String(text);
    var book = s.match(/《[^》\n]{1,60}》/g);
    if (book) out = out.concat(book);
    out = out.concat(matchContentNames(
      s,
      /[\u4e00-\u9fff]{2,10}(?:医院|大学|学院|研究所|研究院|中心|公司|集团|协会|委员会|银行|法院|诊所|实验室|工作室|基金会)/g,
      /(?:医院|大学|学院|研究所|研究院|中心|公司|集团|协会|委员会|银行|法院|诊所|实验室|工作室|基金会)$/
    ));
    out = out.concat(matchContentNames(
      s,
      /[\u4e00-\u9fffA-Za-z0-9]{2,14}(?:指南|共识|标准|法案|条例|规范|白皮书|报告|公报)/g,
      /(?:指南|共识|标准|法案|条例|规范|白皮书|报告|公报)$/
    ));
    out = out.concat(matchContentNames(
      s,
      /[\u4e00-\u9fffA-Za-z]{2,8}(?:片|胶囊|颗粒|注射液|口服液|软膏|滴丸|喷雾剂|栓剂)/g,
      /(?:片|胶囊|颗粒|注射液|口服液|软膏|滴丸|喷雾剂|栓剂)$/
    ));
    // 英文大写序列（≥2 词，或非句首单个专有词）
    var eng = s.match(/\b[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)+\b/g);
    if (eng) out = out.concat(eng);
    var single = s.match(/(?<=[a-z,;:(\s]\s)([A-Z][A-Za-z]{2,})\b/g);
    if (single) {
      for (var i = 0; i < single.length; i++) {
        var w = single[i].replace(/^\s+/, "");
        if (!/^(The|This|That|These|Those|It|He|She|They|We|You|I|A|An|And|But|Or|If|When|While|After|Before|Because|However|Therefore|Thus|Then|Also|First|Second|Third|Finally|In|On|At|By|For|From|With|Without|Its|Our|Their|My|Your)$/.test(w)) {
          out.push(w);
        }
      }
    }
    return out;
  }

  /** 情态/程度词（规格固定清单）+ 因果论断动词（验收测试 4 要求覆盖相关/导致）。 */
  var STRENGTH_ZH = ["可能", "或许", "通常", "多数", "部分", "显著", "唯一", "主要", "建议", "应当", "应该", "必须"];
  var CAUSAL_ZH = ["相关", "关联", "导致", "造成", "引起", "引发", "表明", "说明", "证明", "提示", "意味着", "反映出", "有助于", "有利于", "风险", "诱发"];
  var HEDGE_ZH = ["可能", "或许", "也许", "大概", "某种程度上", "在一定程度上", "一定程度上", "从某种意义上", "可以说", "兴许", "貌似"];
  var DEFINITE_ZH = ["会", "将会", "一定", "必然", "肯定", "总是", "从不", "绝对"];
  var STRENGTH_EN = ["may", "might", "could", "possibly", "perhaps", "probably", "likely", "usually", "often", "most", "some", "partly", "partially", "significantly", "only", "mainly", "recommend", "should", "must", "will", "suggest"];
  var CAUSAL_EN = ["associated", "correlated", "causes", "cause", "leads to", "lead to", "indicates", "suggests", "shows", "proves", "implies", "implies", "risk", "risks", "linked to"];

  function countWordSet(text, words, isEn) {
    var out = {};
    var s = isEn ? String(text).toLowerCase() : String(text);
    for (var i = 0; i < words.length; i++) {
      var w = isEn ? words[i].toLowerCase() : words[i];
      var re = isEn
        ? new RegExp("\\b" + escapeRegex(w) + "\\b", "g")
        : new RegExp(escapeRegex(w), "g");
      var n = (s.match(re) || []).length;
      if (n > 0) out[words[i]] = n;
    }
    return out;
  }

  function mergeCounts(a, b) {
    var out = {};
    var k;
    for (k in a) if (a.hasOwnProperty(k)) out[k] = (out[k] || 0) + a[k];
    for (k in b) if (b.hasOwnProperty(k)) out[k] = (out[k] || 0) + b[k];
    return out;
  }

  // ---------- 模糊匹配（兜底提示句保真用） ----------

  function normalizeForCompare(s) {
    return String(s)
      .toLowerCase()
      .replace(/[\s\p{P}\p{S}]+/gu, "");
  }

  /** 字符重叠率（较短串被较长串覆盖的比例），0–1。 */
  function overlapRatio(a, b) {
    var na = normalizeForCompare(a);
    var nb = normalizeForCompare(b);
    if (!na.length || !nb.length) return 0;
    if (na === nb) return 1;
    var setB = {};
    for (var i = 0; i < nb.length; i++) setB[nb[i]] = true;
    var hit = 0;
    for (var j = 0; j < na.length; j++) if (setB[na[j]]) hit++;
    return hit / na.length;
  }

  // ---------- 哈希（缓存键） ----------

  function hashText(text) {
    var s = String(text);
    if (typeof crypto !== "undefined" && crypto.subtle && crypto.subtle.digest && typeof TextEncoder !== "undefined") {
      var data = new TextEncoder().encode(s);
      return crypto.subtle.digest("SHA-256", data).then(function (buf) {
        return Array.prototype.map
          .call(new Uint8Array(buf), function (b) {
            return ("00" + b.toString(16)).slice(-2);
          })
          .join("");
      });
    }
    // Node 回退
    var cryptoNode = require("crypto");
    return Promise.resolve(cryptoNode.createHash("sha256").update(s, "utf8").digest("hex"));
  }

  return {
    escapeRegex: escapeRegex,
    round: round,
    clamp: clamp,
    maskZones: maskZones,
    splitBlocks: splitBlocks,
    proseParagraphs: proseParagraphs,
    splitSentences: splitSentences,
    splitClauses: splitClauses,
    countHanzi: countHanzi,
    countWords: countWords,
    mean: mean,
    stdDev: stdDev,
    coefficientOfVariation: coefficientOfVariation,
    countEmoji: countEmoji,
    EMOJI_RE: EMOJI_RE,
    extractNumbers: extractNumbers,
    extractUrls: extractUrls,
    extractCode: extractCode,
    extractFormulas: extractFormulas,
    extractQuotes: extractQuotes,
    extractProperNouns: extractProperNouns,
    STRENGTH_ZH: STRENGTH_ZH,
    CAUSAL_ZH: CAUSAL_ZH,
    HEDGE_ZH: HEDGE_ZH,
    DEFINITE_ZH: DEFINITE_ZH,
    STRENGTH_EN: STRENGTH_EN,
    CAUSAL_EN: CAUSAL_EN,
    countWordSet: countWordSet,
    mergeCounts: mergeCounts,
    normalizeForCompare: normalizeForCompare,
    overlapRatio: overlapRatio,
    hashText: hashText
  };
});
