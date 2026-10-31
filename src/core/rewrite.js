/**
 * rewrite.js —— L3 改写模块（只把命中项作为重点；事实占位符保护；三层校验 + 闭环复扫；降级优先）
 * 任何失败（超时/解析失败/校验不通过/复扫未改善）一律返回原文并说明原因，绝不返回更差的文本。
 */
(function (root, factory) {
  var isNode = typeof module !== "undefined" && module.exports;
  var engine = isNode ? require("./engine.js") : root.DeaiEngine;
  var prompts = isNode ? require("./prompts.js") : root.DeaiPrompts;
  var verifyMod = isNode ? require("./verify.js") : root.DeaiVerify;
  var rescanMod = isNode ? require("./rescan.js") : root.DeaiRescan;
  // 浏览器下惰性兜底：脚本加载顺序不应成为隐患（先捕获，缺失则调用时再取全局）
  function getVerify() {
    return verifyMod || (root && root.DeaiVerify);
  }
  function getRescan() {
    return rescanMod || (root && root.DeaiRescan);
  }
  var api = factory(engine, prompts, getVerify, getRescan, root);
  if (isNode) {
    module.exports = api;
  }
  if (root) {
    root.DeaiRewrite = api;
  }
})(typeof self !== "undefined" ? self : this, function (E, Prompts, getVerify, getRescan, root) {
  "use strict";

  // ---------- 事实占位符保护（v1 单条提示词的安全设计，作为额外保险层） ----------

  var TOKEN_PREFIX = "\u27E6T"; // ⟦T
  var TOKEN_SUFFIX = "\u27E7"; // ⟦⟧

  function makeToken(i) {
    return TOKEN_PREFIX + i + TOKEN_SUFFIX;
  }

  function extractFactSpans(text) {
    var s = String(text);
    var spans = [];
    function pushAll(arr) {
      for (var i = 0; i < arr.length; i++) spans.push(arr[i]);
    }
    // 代码块/行内代码
    var code = [];
    var fence = s.match(/^[ \t]*(?:```|~~~)[^\n]*\n[\s\S]*?(?:^[ \t]*(?:```|~~~)[ \t]*$|$)/gm) || [];
    for (var f = 0; f < fence.length; f++) {
      code.push({ start: s.indexOf(fence[f]), end: s.indexOf(fence[f]) + fence[f].length, text: fence[f] });
    }
    var inline = s.match(/`[^`\n]+`/g) || [];
    for (var c = 0; c < inline.length; c++) {
      var ci = s.indexOf(inline[c]);
      if (ci >= 0) code.push({ start: ci, end: ci + inline[c].length, text: inline[c] });
    }
    pushAll(code);
    // URL
    var urls = s.match(/https?:\/\/[^\s)\]}>"'`<>，。；]+/g) || [];
    for (var u = 0; u < urls.length; u++) {
      var ui = s.indexOf(urls[u]);
      if (ui >= 0) spans.push({ start: ui, end: ui + urls[u].length, text: urls[u] });
    }
    // 公式
    var formulas = s.match(/\$\$[\s\S]+?\$\$/g) || [];
    for (var fo = 0; fo < formulas.length; fo++) {
      var fi = s.indexOf(formulas[fo]);
      if (fi >= 0) spans.push({ start: fi, end: fi + formulas[fo].length, text: formulas[fo] });
    }
    // 数字 + 单位
    var nums = s.match(/-?\d+(?:[.,]\d+)?(?:\s*(?:%|％|mg|ug|ml|g|kg|km|mm|cm|m|万|亿|千|次|天|小时|分钟|秒|年|月|日|周|倍|px|pt|dB|GB|MB|KB|TB|GHz|MHz|kHz|W|kW|V|A|℃|°C|°F|元|万元|美元|欧元|岁|人|例|名|位|ms|帧|版|级|步|页|字|行|列|组|批|份|家|台|条|项|款|部|集|期|届|轮|层|个|件))?(?![\d%A-Za-z\u4e00-\u9fff])/g) || [];
    for (var n = 0; n < nums.length; n++) {
      var ni = nthIndex(s, nums[n], n);
      if (ni >= 0) spans.push({ start: ni, end: ni + nums[n].length, text: nums[n] });
    }
    // 引文
    var quotes = [];
    var pairs = [/“([^”\n]{1,200})”/g, /「([^」\n]{1,200})」/g, /『([^』\n]{1,200})』/g];
    for (var p = 0; p < pairs.length; p++) {
      var m;
      while ((m = pairs[p].exec(s)) !== null) {
        quotes.push({ start: m.index, end: m.index + m[0].length, text: m[0] });
      }
    }
    pushAll(quotes);
    // 专名（机构/药物/书名）
    var nouns = [];
    var org = s.match(/[\u4e00-\u9fff]{2,10}(?:医院|大学|学院|研究所|研究院|中心|公司|集团|协会|委员会|银行|法院|诊所|实验室)/g) || [];
    var book = s.match(/《[^》\n]{1,60}》/g) || [];
    var drug = s.match(/[\u4e00-\u9fffA-Za-z]{2,8}(?:片|胶囊|颗粒|注射液|口服液|软膏|滴丸|喷雾剂)/g) || [];
    var all = org.concat(book, drug);
    for (var q = 0; q < all.length; q++) {
      var qi = s.indexOf(all[q]);
      if (qi >= 0) nouns.push({ start: qi, end: qi + all[q].length, text: all[q] });
    }
    pushAll(nouns);

    // 排序并去重（保留长跨度优先）
    spans.sort(function (a, b) {
      return b.end - b.start - (a.end - a.start);
    });
    var kept = [];
    for (var k = 0; k < spans.length; k++) {
      var ok = true;
      for (var l = 0; l < kept.length; l++) {
        if (spans[k].start < kept[l].end && spans[k].end > kept[l].start) {
          ok = false;
          break;
        }
      }
      if (ok) kept.push(spans[k]);
    }
    kept.sort(function (a, b) {
      return a.start - b.start;
    });
    return kept;
  }

  function nthIndex(s, needle, occurrence) {
    // 简化：按顺序找第 n 个出现（对重复数字足够）
    var idx = -1;
    for (var i = 0; i <= occurrence; i++) {
      idx = s.indexOf(needle, idx + 1);
      if (idx < 0) return -1;
    }
    return idx;
  }

  function protectFacts(text) {
    var spans = extractFactSpans(text);
    var tokens = [];
    var out = "";
    var cursor = 0;
    for (var i = 0; i < spans.length; i++) {
      out += text.slice(cursor, spans[i].start);
      var tok = makeToken(i + 1);
      tokens.push({ token: tok, text: spans[i].text, order: i });
      out += tok;
      cursor = spans[i].end;
    }
    out += text.slice(cursor);
    return { text: out, tokens: tokens };
  }

  /** 回填：每个占位符必须恰好出现一次且顺序不变，否则失败（上层回退原文）。 */
  function restoreFacts(protectedOutput, tokens) {
    var s = String(protectedOutput);
    var positions = [];
    for (var i = 0; i < tokens.length; i++) {
      var first = s.indexOf(tokens[i].token);
      if (first < 0) {
        return { ok: false, reason: "占位符丢失：" + tokens[i].token + "（" + tokens[i].text + "）" };
      }
      if (s.indexOf(tokens[i].token, first + 1) >= 0) {
        return { ok: false, reason: "占位符重复：" + tokens[i].token };
      }
      positions.push(first);
    }
    for (var j = 1; j < positions.length; j++) {
      if (positions[j] < positions[j - 1]) {
        return { ok: false, reason: "占位符顺序错乱（疑似事实被移动/互换）" };
      }
    }
    var out = s;
    for (var k = tokens.length - 1; k >= 0; k--) {
      out = out.replace(tokens[k].token, tokens[k].text);
    }
    return { ok: true, text: out };
  }

  // ---------- 输出解析 ----------

  function parseRewriteOutput(raw) {
    var s = String(raw || "").replace(/^\s*```(?:markdown|md)?\s*/i, "").replace(/```\s*$/i, "").trim();
    var m = s.match(/^[［\[]\s*终稿\s*[］\]]\s*$/m);
    var bodyStart = m ? m.index + m[0].length : -1;
    if (bodyStart < 0) {
      m = s.match(/^[［\[]\s*终稿\s*[］\]]/m);
      if (m) bodyStart = m.index + m[0].length;
    }
    if (bodyStart < 0) return { ok: false, reason: "输出缺少［终稿］标记（解析失败）" };
    var rest = s.slice(bodyStart);
    var sep = rest.search(/\n-{3,}\s*\n/);
    var finalText;
    var tail;
    if (sep >= 0) {
      finalText = rest.slice(0, sep);
      tail = rest.slice(sep);
    } else {
      // 没有 --- 分隔：按小节标题切
      var secIdx = rest.search(/\n(?=(?:改动说明|【观察项】|【需作者确认】|【待补】))/);
      if (secIdx >= 0) {
        finalText = rest.slice(0, secIdx);
        tail = rest.slice(secIdx);
      } else {
        finalText = rest;
        tail = "";
      }
    }
    finalText = finalText.replace(/^\s*\n+/, "").replace(/\s+$/, "");
    if (!finalText.trim()) return { ok: false, reason: "［终稿］为空（解析失败）" };

    function section(name) {
      var re = new RegExp("【" + name + "】([^【]*)");
      var mm = tail.match(re);
      if (!mm) return [];
      return mm[1]
        .split(/\n/)
        .map(function (l) {
          return l.replace(/^[-*]\s*/, "").trim();
        })
        .filter(function (l) {
          return l.length > 0;
        });
    }
    var changes = [];
    var cm = tail.match(/改动说明([^【]*)/);
    if (cm) {
      changes = cm[1]
        .split(/\n/)
        .map(function (l) {
          return l.replace(/^[-*\d.、)\s]+/, "").trim();
        })
        .filter(function (l) {
          return l.length > 0;
        })
        .slice(0, 8);
    }
    return {
      ok: true,
      text: finalText,
      report: {
        changes: changes,
        watch: section("观察项"),
        confirm: section("需作者确认"),
        todo: section("待补")
      }
    };
  }

  // ---------- 缓存 ----------

  var memoryCache = {};

  function cacheKey(text, register, model, targetIds, modelName) {
    return [E.round(text.length, 0), register, model, modelName, targetIds.join("+"), simpleHash(text)].join("|");
  }

  function simpleHash(s) {
    var h = 5381;
    for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
    return h.toString(16);
  }

  // ---------- API 调用 ----------

  function callModel(prompt, opts) {
    var fetchImpl = opts.fetchImpl || (typeof fetch !== "undefined" ? fetch : null);
    if (!fetchImpl) {
      return Promise.reject(new Error("当前环境没有 fetch，无法调用改写模型"));
    }
    var url = (opts.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions";
    var headers = { "Content-Type": "application/json" };
    var body;
    if ((opts.apiType || "openai") === "anthropic") {
      url = (opts.baseUrl || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages";
      headers = {
        "Content-Type": "application/json",
        "x-api-key": opts.apiKey || "",
        "anthropic-version": "2023-06-01"
      };
      body = {
        model: opts.modelName || "claude-sonnet-4-5",
        max_tokens: opts.maxTokens || 4096,
        system: "你是文本改写器。严格按用户给出的格式输出。",
        messages: [{ role: "user", content: prompt }]
      };
    } else {
      headers.Authorization = "Bearer " + (opts.apiKey || "");
      body = {
        model: opts.modelName || "gpt-4o",
        temperature: opts.temperature === undefined ? 0.3 : opts.temperature,
        messages: [{ role: "user", content: prompt }]
      };
    }
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = null;
    if (controller) {
      timer = setTimeout(function () {
        controller.abort();
      }, opts.timeoutMs || 120000);
    }
    return fetchImpl(url, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(body),
      signal: controller ? controller.signal : undefined
    })
      .then(function (res) {
        if (timer) clearTimeout(timer);
        if (!res.ok) {
          throw new Error("API 返回 " + res.status);
        }
        return res.json();
      })
      .then(function (data) {
        if (data && data.choices && data.choices[0] && data.choices[0].message) {
          return data.choices[0].message.content;
        }
        if (data && data.content && data.content[0] && data.content[0].text) {
          return data.content[0].text;
        }
        throw new Error("API 响应结构无法解析");
      });
  }

  // ---------- 主入口 ----------

  /**
   * rewrite(text, scanResult, opts) -> Promise<{ ok, text, report, fallbackReason, violations, rescan }>
   * opts: { register, model, apiKey, baseUrl, apiType, modelName, temperature, timeoutMs,
   *         usePlaceholders, fetchImpl, force, rules, extraNote, mockRewriter }
   */
  function rewrite(text, scanResult, opts) {
    opts = opts || {};
    var original = String(text || "");
    var register = opts.register || "qa";
    var model = opts.model || "unknown";

    function fail(reason, extra) {
      var out = { ok: false, text: original, fallbackReason: reason, report: null };
      if (extra) {
        for (var k in extra) out[k] = extra[k];
      }
      return Promise.resolve(out);
    }

    // 本次重点 = 偏高/高（观察项默认不改）
    var targets = (scanResult && scanResult.stats ? scanResult.stats : []).filter(function (x) {
      return x.level === "elevated" || x.level === "high";
    });
    if (!targets.length && !opts.force) {
      return fail("本次没有达到阈值的特征（无需改写），原文返回");
    }

    // 缓存
    var key = cacheKey(original, register, model, targets.map(function (t) { return t.id; }), opts.modelName || "");
    if (memoryCache[key] && !opts.skipCache) {
      return Promise.resolve(
        (function (c) {
          var out = Object.assign({}, c);
          out.cached = true;
          return out;
        })(memoryCache[key])
      );
    }

    if (!opts.mockRewriter && (!opts.apiKey || !String(opts.apiKey).trim())) {
      return fail("未配置 API Key：降级返回原文");
    }

    // 占位符保护
    var protectedRes = usePlaceholderProtection(opts) ? protectFacts(original) : { text: original, tokens: [] };
    var prompt = Prompts.buildRewriteMessages(protectedRes.text, targets, register, model, { extraNote: opts.extraNote });

    var modelPromise;
    if (opts.mockRewriter) {
      modelPromise = Promise.resolve(opts.mockRewriter(protectedRes.text, targets, opts));
    } else {
      modelPromise = callModel(prompt, opts);
    }

    return modelPromise
      .then(function (raw) {
        var parsed = parseRewriteOutput(raw);
        if (!parsed.ok) return fail(parsed.reason);
        var restored;
        if (protectedRes.tokens.length) {
          restored = restoreFacts(parsed.text, protectedRes.tokens);
          if (!restored.ok) return fail("事实占位符回填失败：" + restored.reason);
        } else {
          restored = { ok: true, text: parsed.text };
        }
        var finalText = restored.text;

        // L4 三层校验
        var v = getVerify().verify(original, finalText, register, model);
        if (!v.ok) {
          return fail("校验未通过，已回退原文", { violations: v.violations });
        }

        // L5 闭环复扫
        var rc = getRescan().rescan(original, finalText, scanResult, { register: register, model: model, rules: opts.rules });
        if (!rc.ok) {
          return fail("闭环复扫未通过，已回退原文：" + rc.reason, { rescan: { notImproved: rc.notImproved, newElevated: rc.newElevated } });
        }

        var result = {
          ok: true,
          text: finalText,
          report: parsed.report,
          violations: [],
          rescan: { resolved: rc.resolved, newElevated: rc.newElevated },
          targetIds: targets.map(function (t) {
            return t.id + (t.variantId ? "/" + t.variantId : "");
          }),
          placeholderCount: protectedRes.tokens.length
        };
        memoryCache[key] = result;
        return result;
      })
      .catch(function (err) {
        return fail("模型调用失败（" + (err && err.message ? err.message : err) + "），已降级返回原文");
      });
  }

  function usePlaceholderProtection(opts) {
    return opts.usePlaceholders !== false;
  }

  /** L1：一键取得生成侧提示词（注入 system prompt）。 */
  function generationPrompt(userTask) {
    return Prompts.buildGenerationSystemPrompt(userTask);
  }

  return {
    rewrite: rewrite,
    protectFacts: protectFacts,
    restoreFacts: restoreFacts,
    parseRewriteOutput: parseRewriteOutput,
    generationPrompt: generationPrompt,
    _clearCache: function () {
      memoryCache = {};
    }
  };
});
