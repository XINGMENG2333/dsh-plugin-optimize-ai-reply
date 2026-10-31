/**
 * verify.js —— L4 三层（五层）校验器（纯函数、可单测）
 * verify(before, after, register?, model?) -> { ok, violations[] }
 * 1 事实层：数字/单位、URL、代码、公式、引文、专名 逐字比对（多重集）
 * 2 强度层：情态与程度词多重集（+因果论断动词），整句删除豁免、对冲堆叠消解豁免
 * 3 主次层：「X 是关键，Y 也…」结构不得被拉平
 * 4 安全层：❌✗⚠️ → 文字否定；兜底提示必须保留；危险加粗必须保留；禁止新增氛围细节
 * 5 结构层：标题层级、代码块数、表格行数不变；列表只允许 ≤4 项并入句子
 * 任一 fail -> ok=false，上层回退原文。
 */
(function (root, factory) {
  var engine =
    (typeof module !== "undefined" && module.exports)
      ? require("./engine.js")
      : root.DeaiEngine;
  var api = factory(engine);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DeaiVerify = api;
  }
})(typeof self !== "undefined" ? self : this, function (E) {
  "use strict";

  var SAFETY_MARKERS = /[❌✗⚠️]/;
  var NEGREATION = /(别|不要|不得|不能|禁止|切勿|勿|忌|禁|do not|don't|never|avoid|must not)/i;
  var SAFETY_KEYWORDS = /(危险|注意|禁忌|就医|就诊|别|不要|警告|warning|danger|caution|never|do not)/i;
  var CATCH_ALL = /(有疑问[^。！？\n]{0,16}(?:就医|就诊|咨询)|(?:及时|尽快)(?:就医|就诊)|(?:如|若)[^。！？\n]{0,12}(?:加重|不适|恶化|反复)[^。！？\n]{0,12}(?:就医|就诊)|咨询(?:医生|医师)|遵医嘱|不适随诊|ask (?:a |your )?doctor|seek (?:medical|professional) (?:help|attention)|consult (?:a |your )?doctor)/i;
  var ATMOSPHERE = ["凌晨三点", "凌晨 3 点", "窗外下着雨", "窗外的雨", "雨敲打着窗", "他愣了一下", "愣了一下", "深吸一口气", "眼中闪过", "眼底闪过", "嘴角微微上扬", "嘴角上扬", "心中一紧", "沉默了片刻", "阳光透过窗帘", "阳光透过窗户", "空气中弥漫", "空气凝固"];

  // ---------- 多重集工具 ----------

  function toMultiset(arr) {
    var out = {};
    for (var i = 0; i < arr.length; i++) {
      var k = arr[i];
      out[k] = (out[k] || 0) + 1;
    }
    return out;
  }

  function multisetDiff(a, b) {
    // a 有 b 没有 / 数量差
    var missing = [];
    var extra = [];
    var k;
    for (k in a) {
      if (!b[k]) missing.push({ key: k, count: a[k] });
      else if (b[k] < a[k]) missing.push({ key: k, count: a[k] - b[k] });
    }
    for (k in b) {
      if (!a[k]) extra.push({ key: k, count: b[k] });
      else if (b[k] > a[k]) extra.push({ key: k, count: b[k] - a[k] });
    }
    return { missing: missing, extra: extra };
  }

  // ---------- 句子级切分与匹配 ----------

  function sentencesOf(text) {
    var out = [];
    var lines = String(text).split("\n");
    var offset = 0;
    var inFence = false;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (/^[ \t]*(?:```|~~~)/.test(line)) {
        inFence = !inFence;
        offset += line.length + 1;
        continue;
      }
      // 代码块内、表格行不参与句子级比对（由事实层/结构层负责）
      if (!inFence && !/^\s*\|/.test(line)) {
        var ss = E.splitSentences(line, offset);
        for (var j = 0; j < ss.length; j++) out.push(ss[j]);
      }
      offset += line.length + 1;
    }
    return out;
  }

  function findCounterpart(sentence, afterSentences) {
    var best = null;
    var bestScore = 0;
    for (var i = 0; i < afterSentences.length; i++) {
      var score = E.overlapRatio(sentence.text, afterSentences[i].text);
      if (score > bestScore) {
        bestScore = score;
        best = afterSentences[i];
      }
    }
    return bestScore >= 0.6 ? { sentence: best, score: bestScore } : null;
  }

  /**
   * 全局句对齐：
   * ① 重叠 ≥0.6 的先配对；
   * ② 剩余 before 句与剩余 after 句按出现顺序一一配对（=低重叠改写）；
   * ③ 对方无剩余的 before 句才算「整句删除」。
   */
  function alignSentences(bSentences, aSentences) {
    var usedA = {};
    var pairs = [];
    var unmatchedB = [];
    var i, j;
    for (i = 0; i < bSentences.length; i++) {
      var best = -1;
      var bestScore = 0.6;
      for (j = 0; j < aSentences.length; j++) {
        if (usedA[j]) continue;
        var score = E.overlapRatio(bSentences[i].text, aSentences[j].text);
        if (score >= bestScore) {
          bestScore = score;
          best = j;
        }
      }
      if (best >= 0) {
        usedA[best] = true;
        pairs.push({ before: bSentences[i], after: aSentences[best], matched: true });
      } else {
        unmatchedB.push(bSentences[i]);
      }
    }
    var unmatchedA = [];
    for (j = 0; j < aSentences.length; j++) {
      if (!usedA[j]) unmatchedA.push(aSentences[j]);
    }
    var deleted = [];
    for (i = 0; i < unmatchedB.length; i++) {
      if (unmatchedA.length > i) {
        pairs.push({ before: unmatchedB[i], after: unmatchedA[i], matched: false });
      } else {
        deleted.push(unmatchedB[i]);
      }
    }
    return { pairs: pairs, deleted: deleted };
  }

  function hasFactContent(sentence) {
    return (
      /\d/.test(sentence.text) ||
      /https?:\/\//.test(sentence.text) ||
      /`[^`]+`/.test(sentence.text) ||
      /《[^》]+》/.test(sentence.text) ||
      /“[^”]+”|「[^」]+」/.test(sentence.text) ||
      /[A-Za-z]{2,}/.test(sentence.text)
    );
  }

  // ---------- 1 事实层 ----------

  function factLayer(before, after, violations) {
    var bFacts = {
      numbers: toMultiset(E.extractNumbers(before)),
      urls: toMultiset(E.extractUrls(before)),
      code: toMultiset(E.extractCode(before)),
      formulas: toMultiset(E.extractFormulas(before)),
      quotes: toMultiset(E.extractQuotes(before))
    };
    var aFacts = {
      numbers: toMultiset(E.extractNumbers(after)),
      urls: toMultiset(E.extractUrls(after)),
      code: toMultiset(E.extractCode(after)),
      formulas: toMultiset(E.extractFormulas(after)),
      quotes: toMultiset(E.extractQuotes(after))
    };
    var labels = { numbers: "数字/单位", urls: "URL", code: "代码", formulas: "公式", quotes: "引文" };
    for (var key in bFacts) {
      var d = multisetDiff(bFacts[key], aFacts[key]);
      for (var i = 0; i < d.missing.length; i++) {
        violations.push({ layer: "fact", message: labels[key] + "缺失或被改动：" + d.missing[i].key + (d.missing[i].count > 1 ? " ×" + d.missing[i].count : ""), detail: d.missing[i] });
      }
      for (var j = 0; j < d.extra.length; j++) {
        violations.push({ layer: "fact", message: labels[key] + "被新增：" + d.extra[j].key + (d.extra[j].count > 1 ? " ×" + d.extra[j].count : ""), detail: d.extra[j] });
      }
    }
    // 专名：双向存在（允许重复次数变化，不允许出现/消失）
    var bNouns = toMultiset(E.extractProperNouns(before));
    var aNouns = toMultiset(E.extractProperNouns(after));
    for (var nk in bNouns) {
      if (!aNouns[nk]) violations.push({ layer: "fact", message: "专名缺失：" + nk, detail: { key: nk } });
    }
    for (var ak in aNouns) {
      if (!bNouns[ak]) violations.push({ layer: "fact", message: "专名新增（可能编造）：" + ak, detail: { key: ak } });
    }
  }

  // ---------- 2 强度层 ----------

  var SOFT_HEDGE = ["可能", "或许", "也许", "大概", "兴许", "貌似", "某种程度上", "在一定程度上", "一定程度上", "从某种意义上", "可以说", "may", "might", "could", "possibly", "perhaps"];

  function containsHardStrength(text, isEn) {
    var t = isEn ? text.toLowerCase() : text;
    var hard = isEn
      ? E.STRENGTH_EN.concat(E.CAUSAL_EN).filter(function (w) { return SOFT_HEDGE.indexOf(w.toLowerCase()) < 0; })
      : E.STRENGTH_ZH.concat(E.CAUSAL_ZH).filter(function (w) { return SOFT_HEDGE.indexOf(w) < 0; });
    for (var i = 0; i < hard.length; i++) {
      var w = isEn ? hard[i].toLowerCase() : hard[i];
      if (isEn ? new RegExp("\\b" + w + "\\b").test(t) : t.indexOf(w) >= 0) return true;
    }
    return false;
  }

  function strengthLayer(before, after, violations) {
    var isEn = E.countWords(before) > E.countHanzi(before);
    var strengthWords = isEn ? E.STRENGTH_EN : E.STRENGTH_ZH;
    var causalWords = isEn ? E.CAUSAL_EN : E.CAUSAL_ZH;

    var bStrength = toMultiset(multisetKeys(E.countWordSet(before, strengthWords, isEn)));
    var aStrength = toMultiset(multisetKeys(E.countWordSet(after, strengthWords, isEn)));
    var bCausal = toMultiset(multisetKeys(E.countWordSet(before, causalWords, isEn)));
    var aCausal = toMultiset(multisetKeys(E.countWordSet(after, causalWords, isEn)));

    var bSentences = sentencesOf(before);
    var aSentences = sentencesOf(after);
    var align = alignSentences(bSentences, aSentences);

    // 新增强度词一律不允许（加强或减弱都违反「不改论断强度」）
    checkAdded(bStrength, aStrength, "情态/程度词", violations);
    checkAdded(bCausal, aCausal, "因果/论断动词", violations);

    // 配对句（含低重叠改写）：强度词数量必须一致（对冲堆叠消解除外）
    checkPairCounts(align.pairs, strengthWords, "情态/程度词", violations, isEn);
    checkPairCounts(align.pairs, causalWords, "因果/论断动词", violations, isEn);

    // 整句删除：句内无事实且无硬强度词才豁免
    for (var d = 0; d < align.deleted.length; d++) {
      var bs = align.deleted[d];
      if (!hasFactContent(bs) && !containsHardStrength(bs.text, isEn)) continue;
      var hitHard = containsHardStrength(bs.text, isEn);
      violations.push({
        layer: "strength",
        message: (hitHard ? "含强度/论断词的句子被整句删除：" : "含事实的句子被整句删除：") + bs.text.trim().slice(0, 30),
        detail: { before: bs.text }
      });
    }

    // 对冲 ↔ 确定 的方向变化（可能≠会，反过来也不行）
    for (var i = 0; i < align.pairs.length; i++) {
      var bs2 = align.pairs[i].before;
      var as2 = align.pairs[i].after;
      var bHedge = E.HEDGE_ZH.some(function (w) { return bs2.text.indexOf(w) >= 0; });
      var aHedge = E.HEDGE_ZH.some(function (w) { return as2.text.indexOf(w) >= 0; });
      var bDef = E.DEFINITE_ZH.some(function (w) { return bs2.text.indexOf(w) >= 0; });
      var aDef = E.DEFINITE_ZH.some(function (w) { return as2.text.indexOf(w) >= 0; });
      if (bHedge && !aHedge && aDef && !bDef) {
        violations.push({ layer: "strength", message: "强度被加强（可能→会 类）：" + bs2.text.trim().slice(0, 30), detail: { before: bs2.text, after: as2.text } });
      }
      if (bDef && !aDef && aHedge && !bHedge) {
        violations.push({ layer: "strength", message: "强度被减弱（会→可能 类）：" + bs2.text.trim().slice(0, 30), detail: { before: bs2.text, after: as2.text } });
      }
    }
  }

  function checkPairCounts(pairs, words, label, violations, isEn) {
    for (var i = 0; i < pairs.length; i++) {
      var bs = pairs[i].before;
      var as = pairs[i].after;
      for (var w = 0; w < words.length; w++) {
        var word = words[w];
        var bCount = countWordIn(bs.text, word, isEn);
        if (!bCount) continue;
        var aCount = countWordIn(as.text, word, isEn);
        if (aCount < bCount) {
          // 对冲堆叠消解豁免：同句对冲词 ≥2 且改后仍有对冲词
          var hedgeCount = 0;
          for (var h = 0; h < E.HEDGE_ZH.length; h++) hedgeCount += countWordIn(bs.text, E.HEDGE_ZH[h], false);
          var aHedgeCount = 0;
          for (var h2 = 0; h2 < E.HEDGE_ZH.length; h2++) aHedgeCount += countWordIn(as.text, E.HEDGE_ZH[h2], false);
          if (hedgeCount >= 2 && aHedgeCount >= 1 && E.HEDGE_ZH.indexOf(word) >= 0) continue;
          violations.push({ layer: "strength", message: label + "被删减（论断强度可能被改动）：" + word + "（" + bs.text.trim().slice(0, 24) + " → " + as.text.trim().slice(0, 24) + "）", detail: { word: word, before: bCount, after: aCount } });
        }
      }
    }
  }

  function multisetKeys(counts) {
    var out = [];
    for (var k in counts) {
      for (var i = 0; i < counts[k]; i++) out.push(k);
    }
    return out;
  }

  function checkAdded(bSet, aSet, label, violations) {
    var d = multisetDiff(bSet, aSet);
    for (var i = 0; i < d.extra.length; i++) {
      violations.push({ layer: "strength", message: label + "被新增（强度/范围可能被改动）：" + d.extra[i].key, detail: d.extra[i] });
    }
  }

  function countWordIn(text, word, isEn) {
    var t = isEn ? text.toLowerCase() : text;
    var w = isEn ? word.toLowerCase() : word;
    var n = 0;
    var idx = 0;
    while ((idx = t.indexOf(w, idx)) >= 0) {
      n++;
      idx += w.length;
    }
    return n;
  }

  // ---------- 3 主次层 ----------

  var PRIORITY_BEFORE = /(?:是|在于)(?:关键|核心|首要|重点)|关键在于|首先是|最主要/;
  var SECONDARY = /(也|同样|还|其次|再次)/;

  function priorityLayer(before, after, violations) {
    var bSentences = sentencesOf(before);
    var flagged = false;
    for (var i = 0; i < bSentences.length; i++) {
      if (PRIORITY_BEFORE.test(bSentences[i].text) && SECONDARY.test(bSentences[i].text)) {
        flagged = true;
        break;
      }
    }
    if (!flagged) {
      // 跨句结构：「X 是关键。Y 也有影响。」
      for (var j = 0; j + 1 < bSentences.length; j++) {
        if (PRIORITY_BEFORE.test(bSentences[j].text) && SECONDARY.test(bSentences[j + 1].text)) {
          flagged = true;
          break;
        }
      }
    }
    if (!flagged) return;
    var hasPriorityAfter = PRIORITY_BEFORE.test(after);
    var hasSecondaryAfter = SECONDARY.test(after);
    if (!hasPriorityAfter || !hasSecondaryAfter) {
      violations.push({
        layer: "priority",
        message: "主次关系被拉平（「X 是关键，Y 也…」结构消失）",
        detail: { afterPriority: hasPriorityAfter, afterSecondary: hasSecondaryAfter }
      });
    }
  }

  // ---------- 4 安全层 ----------

  function safetyLayer(before, after, violations) {
    var bSentences = sentencesOf(before);
    var aSentences = sentencesOf(after);

    // 4.1 错误做法标记：❌ ✗ ⚠️ 删除必须换文字否定
    for (var i = 0; i < bSentences.length; i++) {
      var bs = bSentences[i];
      if (!SAFETY_MARKERS.test(bs.text)) continue;
      var pair = findCounterpart(bs, aSentences);
      if (!pair) {
        violations.push({ layer: "safety", message: "安全提示被整句删除：" + bs.text.trim().slice(0, 30), detail: { before: bs.text } });
        continue;
      }
      var as = pair.sentence;
      var markerKept = SAFETY_MARKERS.test(as.text);
      if (!markerKept && !NEGREATION.test(as.text)) {
        violations.push({ layer: "safety", message: "❌/⚠️ 标记被删除但未换成文字否定：" + bs.text.trim().slice(0, 30), detail: { before: bs.text, after: as.text } });
      }
    }

    // 4.2 兜底提示必须保留
    for (var j = 0; j < bSentences.length; j++) {
      var bCatch = bSentences[j];
      if (!CATCH_ALL.test(bCatch.text)) continue;
      var found = false;
      for (var k = 0; k < aSentences.length; k++) {
        if (E.overlapRatio(bCatch.text, aSentences[k].text) >= 0.6) {
          found = true;
          break;
        }
        if (CATCH_ALL.test(aSentences[k].text)) {
          found = true;
          break;
        }
      }
      if (!found) {
        violations.push({ layer: "safety", message: "兜底提示被删除：" + bCatch.text.trim().slice(0, 30), detail: { before: bCatch.text } });
      }
    }

    // 4.3 危险/禁忌加粗必须保留
    var bBold = before.match(/\*\*[^*\n]{2,}\*\*/g) || [];
    var aBold = after.match(/\*\*[^*\n]{2,}\*\*/g) || [];
    for (var m = 0; m < bBold.length; m++) {
      var content = bBold[m].replace(/\*\*/g, "");
      if (!SAFETY_KEYWORDS.test(content)) continue;
      var kept = false;
      for (var n = 0; n < aBold.length; n++) {
        if (E.overlapRatio(content, aBold[n].replace(/\*\*/g, "")) >= 0.5) {
          kept = true;
          break;
        }
      }
      if (!kept) {
        violations.push({ layer: "safety", message: "危险/禁忌信息的加粗被移除：" + content.slice(0, 30), detail: { bold: content } });
      }
    }

    // 4.4 禁止新增氛围细节（B16 verifyGuard）
    for (var p = 0; p < ATMOSPHERE.length; p++) {
      var phrase = ATMOSPHERE[p];
      if (after.indexOf(phrase) >= 0 && before.indexOf(phrase) < 0) {
        violations.push({ layer: "safety", message: "新增了原文没有的氛围细节（疑似编造）：" + phrase, detail: { phrase: phrase } });
      }
    }
  }

  // ---------- 5 结构层 ----------

  function headingLevels(text) {
    var out = [];
    var re = /^[ \t]{0,3}(#{1,6})[ \t]+\S/gm;
    var m;
    while ((m = re.exec(text)) !== null) out.push(m[1].length);
    return out;
  }

  function codeBlockCount(text) {
    return (String(text).match(/^[ \t]*(?:```|~~~)/gm) || []).length;
  }

  function tableRowCount(text) {
    return (String(text).match(/^\s*\|[^\n]*$/gm) || []).length;
  }

  function listItemCount(text) {
    return (String(text).match(/^[ \t]*(?:[-*+•]|\d{1,2}[.、)]|[（(]\d{1,2}[)）])\s+\S/gm) || []).length;
  }

  function structureLayer(before, after, violations) {
    var bHead = headingLevels(before);
    var aHead = headingLevels(after);
    if (bHead.join(",") !== aHead.join(",")) {
      violations.push({ layer: "structure", message: "Markdown 标题层级发生变化：" + bHead.join("/") + " → " + aHead.join("/"), detail: { before: bHead, after: aHead } });
    }
    if (codeBlockCount(before) !== codeBlockCount(after)) {
      violations.push({ layer: "structure", message: "代码块数量变化：" + codeBlockCount(before) + " → " + codeBlockCount(after), detail: {} });
    }
    if (tableRowCount(before) !== tableRowCount(after)) {
      violations.push({ layer: "structure", message: "表格行数变化：" + tableRowCount(before) + " → " + tableRowCount(after), detail: {} });
    }
    var bList = listItemCount(before);
    var aList = listItemCount(after);
    // 唯一例外：A3b 允许 ≤4 项列表并成句子
    if (aList > bList) {
      violations.push({ layer: "structure", message: "列表项被新增：" + bList + " → " + aList, detail: { before: bList, after: aList } });
    } else if (bList - aList > 4) {
      violations.push({ layer: "structure", message: "列表项删除超过 4 项（超出 A3b 例外）：" + bList + " → " + aList, detail: { before: bList, after: aList } });
    }
  }

  // ---------- 主入口 ----------

  /**
   * verify(before, after, register?, model?) -> { ok, violations[] }
   */
  function verify(before, after) {
    var violations = [];
    var b = String(before || "");
    var a = String(after || "");
    if (a.trim().length === 0) {
      return { ok: false, violations: [{ layer: "fact", message: "终稿为空", detail: {} }] };
    }
    factLayer(b, a, violations);
    strengthLayer(b, a, violations);
    priorityLayer(b, a, violations);
    safetyLayer(b, a, violations);
    structureLayer(b, a, violations);
    return { ok: violations.length === 0, violations: violations };
  }

  return {
    verify: verify,
    factLayer: factLayer,
    strengthLayer: strengthLayer,
    priorityLayer: priorityLayer,
    safetyLayer: safetyLayer,
    structureLayer: structureLayer
  };
});
