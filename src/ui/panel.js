/**
 * panel.js —— 侧栏主界面逻辑
 * 流程：输入 → 参数 → L2 扫描（本地）→ 展示命中/密度/观察项 → L3 改写（经 background 调模型）
 *       → L4/L5 由 core 完成 → 终稿 + 改动说明 + diff + 复制/回退。
 * 所有 core 调用都包 try/catch，异常只提示不白屏；所有出网都走 background 消息。
 */

"use strict";

// ---------- 工具 ----------

function $(id) {
  return document.getElementById(id);
}

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function toast(msg) {
  var t = $("toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._timer);
  t._timer = setTimeout(function () {
    t.classList.remove("show");
  }, 2200);
}

function setBusy(on, label) {
  var b = $("busy");
  b.innerHTML = on ? '<span class="spinner"></span>' + esc(label || "处理中…") : "";
  $("btnScan").disabled = !!on;
  $("btnRewrite").disabled = !!on;
}

function setStatus(msg, isErr) {
  var el = $("status");
  el.textContent = msg || "";
  el.className = "status" + (isErr ? " err" : "");
}

function banner(id, text, kind) {
  var el = $(id);
  if (!text) {
    el.innerHTML = "";
    return;
  }
  el.innerHTML = '<div class="banner ' + (kind || "info") + '">' + esc(text) + "</div>";
}

function fmtNum(v, digits) {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v !== "number") return String(v);
  var d = digits === undefined ? 3 : digits;
  return String(Math.round(v * Math.pow(10, d)) / Math.pow(10, d));
}

function sendMsg(msg) {
  return new Promise(function (resolve, reject) {
    try {
      chrome.runtime.sendMessage(msg, function (resp) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

function sendTab(tabId, msg) {
  return new Promise(function (resolve, reject) {
    try {
      chrome.tabs.sendMessage(tabId, msg, function (resp) {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(resp);
        }
      });
    } catch (err) {
      reject(err);
    }
  });
}

// 与 rewrite.js 相同的简单哈希（缓存键：文本+register+model+modelName）
function simpleHash(s) {
  var h = 5381;
  for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
}

// ---------- 状态 ----------

var state = {
  rules: null,
  config: null,
  scanResult: null,
  original: "",
  rewritten: "",
  activeRuleId: null,
  bgCached: false
};

var DEFAULT_CONFIG = {
  apiKey: "",
  baseUrl: "https://api.openai.com/v1",
  apiType: "openai",
  modelName: "",
  timeoutSec: 120,
  threshold: 2,
  allowTodo: true,
  showWatch: true,
  l1Enabled: true,
  onlyFinal: false,
  ruleToggles: {}
};

// ---------- 配置 ----------

function loadConfig() {
  return new Promise(function (resolve) {
    try {
      chrome.storage.sync.get("deaiConfig", function (data) {
        if (chrome.runtime.lastError) resolve({});
        else resolve(data || {});
      });
    } catch (err) {
      resolve({});
    }
  });
}

function saveConfigToStore(cfg) {
  return new Promise(function (resolve) {
    try {
      chrome.storage.sync.set({ deaiConfig: cfg }, function () {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch (err) {
      resolve();
    }
  });
}

function mergeConfig(raw) {
  var cfg = {};
  for (var k in DEFAULT_CONFIG) cfg[k] = DEFAULT_CONFIG[k];
  if (raw && typeof raw === "object") {
    for (var k2 in DEFAULT_CONFIG) {
      if (raw[k2] !== undefined) cfg[k2] = raw[k2];
    }
    if (!raw.ruleToggles || typeof raw.ruleToggles !== "object") cfg.ruleToggles = {};
  }
  return cfg;
}

function fillConfigForm() {
  var c = state.config;
  $("cfgApiKey").value = c.apiKey || "";
  $("cfgBaseUrl").value = c.baseUrl || DEFAULT_CONFIG.baseUrl;
  $("cfgApiType").value = c.apiType || "openai";
  $("cfgModelName").value = c.modelName || "";
  $("cfgTimeout").value = c.timeoutSec || 120;
  $("cfgAllowTodo").checked = !!c.allowTodo;
  $("cfgShowWatch").checked = !!c.showWatch;
  $("chkOnlyFinal").checked = !!c.onlyFinal;
  $("numThreshold").value = c.threshold || 2;
  $("btnL1Toggle").textContent = c.l1Enabled ? "L1：开" : "L1：关";
  renderRuleToggles();
}

function readConfigForm() {
  var c = state.config;
  c.apiKey = $("cfgApiKey").value.trim();
  c.baseUrl = $("cfgBaseUrl").value.trim() || DEFAULT_CONFIG.baseUrl;
  c.apiType = $("cfgApiType").value;
  c.modelName = $("cfgModelName").value.trim();
  c.timeoutSec = Math.max(10, Number($("cfgTimeout").value) || 120);
  c.allowTodo = $("cfgAllowTodo").checked;
  c.showWatch = $("cfgShowWatch").checked;
  c.onlyFinal = $("chkOnlyFinal").checked;
  c.threshold = Math.max(1, Number($("numThreshold").value) || 2);
  return c;
}

function saveConfig(showToast) {
  readConfigForm();
  saveConfigToStore(state.config).then(function () {
    if (showToast !== false) toast("已保存");
  });
}

// ---------- 规则与开关 ----------

function loadRules() {
  return fetch(chrome.runtime.getURL("src/core/rules.json"))
    .then(function (r) {
      return r.json();
    })
    .then(function (json) {
      window.DEAI_RULES = json;
      state.rules = json;
      return json;
    });
}

function renderRuleToggles() {
  var box = $("ruleToggles");
  if (!state.rules) return;
  var toggles = (state.config && state.config.ruleToggles) || {};
  var html = "";
  var rules = state.rules.rules || [];
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i];
    var on = toggles[r.id] !== false;
    var isText = r.type === "text";
    html +=
      '<div class="check-row">' +
      '<input type="checkbox" id="tg_' + esc(r.id) + '"' + (on ? " checked" : "") + (isText ? " disabled" : "") + ' data-rid="' + esc(r.id) + '" />' +
      '<label for="tg_' + esc(r.id) + '"><span class="rid">' + esc(r.id) + "</span>" + esc(r.name) +
      (isText ? ' <span class="dim">（禁用清单文本，无检测器）</span>' : "") +
      "</label></div>";
  }
  box.innerHTML = html;
  var inputs = box.querySelectorAll("input[type=checkbox][data-rid]");
  for (var j = 0; j < inputs.length; j++) {
    inputs[j].addEventListener("change", function (e) {
      var rid = e.target.getAttribute("data-rid");
      state.config.ruleToggles[rid] = e.target.checked;
      saveConfigToStore(state.config);
    });
  }
}

// 应用单规则开关：深拷贝 rules，关闭的置 enabled=false
function rulesWithToggles() {
  var clone = JSON.parse(JSON.stringify(state.rules));
  var toggles = (state.config && state.config.ruleToggles) || {};
  for (var i = 0; i < (clone.rules || []).length; i++) {
    var r = clone.rules[i];
    if (toggles[r.id] === false) r.enabled = false;
  }
  return clone;
}

// ---------- 参数下拉 ----------

function fillSelects() {
  var regs = state.rules.registers || {};
  var sels = $("selRegister");
  sels.innerHTML = "";
  for (var k in regs) {
    var o = document.createElement("option");
    o.value = k;
    o.textContent = regs[k].name || k;
    if (regs[k].default) o.selected = true;
    sels.appendChild(o);
  }
  var models = state.rules.models || {};
  var selm = $("selModel");
  selm.innerHTML = "";
  for (var m in models) {
    var om = document.createElement("option");
    om.value = m;
    om.textContent = (models[m].name || m) + (models[m].hasBaseline === false ? "（无基线）" : "");
    if (m === "unknown") om.selected = true;
    selm.appendChild(om);
  }
  selm.addEventListener("change", updateModelNote);
  updateModelNote();
}

function updateModelNote() {
  var key = $("selModel").value;
  var info = (state.rules.models || {})[key];
  if (info && info.hasBaseline === false) {
    banner("modelNote", "该模型无基线数据：" + (info.note || "按 A 组全查"), "warn");
  } else if (info && info.note) {
    banner("modelNote", "模型重点查：" + info.note, "info");
  } else {
    banner("modelNote", "", "info");
  }
}

// ---------- 扫描 ----------

function doScan() {
  var text = $("inputText").value;
  if (!text.trim()) {
    setStatus("请先粘贴或抓取文本。", true);
    return null;
  }
  state.original = text;
  var register = $("selRegister").value || "qa";
  var model = $("selModel").value || "unknown";
  var threshold = Math.max(1, Number($("numThreshold").value) || 2);
  readConfigForm();
  saveConfigToStore(state.config);

  var res = null;
  try {
    res = window.DeaiScan.scan(text, register, model, rulesWithToggles(), {
      thresholdMultiplier: threshold
    });
  } catch (err) {
    setStatus("本地扫描出错：" + (err && err.message ? err.message : err), true);
    return null;
  }
  state.scanResult = res;
  state.activeRuleId = null;
  renderScan(res);
  return res;
}

function renderScan(res) {
  $("scanArea").hidden = false;
  var meta = res.meta || {};
  var flag = window.DeaiScan.documentFlag(res);

  // 摘要行
  var counts =
    "汉字 " + (meta.hanzi || 0) + " ｜ 词数 " + (meta.words || 0) +
    " ｜ 句 " + (meta.sentences || 0) + " ｜ 段 " + (meta.paragraphs || 0);
  $("summaryLine").innerHTML = flag.flagged
    ? "有 <b>" + flag.elevated.length + "</b> 项达到阈值 ｜ " + esc(counts)
    : "未达阈值（无需改写也可以直接用） ｜ " + esc(counts);

  // 无基线 / 过期规则提示
  if (meta.modelHasBaseline === false && meta.modelNote) {
    banner("modelNote", meta.modelNote, "warn");
  }
  if (meta.staleDowngraded && meta.staleDowngraded.length) {
    var names = meta.staleDowngraded
      .map(function (x) {
        return typeof x === "string" ? x : x.name || x.id || "";
      })
      .filter(Boolean)
      .join("、");
    banner("staleNote", "⚠ 规则已过期待复核：" + names, "warn");
  } else {
    banner("staleNote", "");
  }

  // 特征表
  var tbody = $("statsTable").querySelector("tbody");
  var rows = (res.stats || []).filter(function (s) {
    return s.hits > 0;
  });
  rows.sort(function (a, b) {
    var w = { high: 3, elevated: 2, watch: 1, normal: 0 };
    return (w[b.level] || 0) - (w[a.level] || 0) || b.hits - a.hits;
  });
  var html = "";
  for (var i = 0; i < rows.length; i++) {
    var s = rows[i];
    html +=
      '<tr class="clickable" data-rid="' + esc(s.id) + '" data-variant="' + esc(s.variantId || "") + '">' +
      "<td>" + esc(s.name) + "</td>" +
      '<td class="num">' + s.hits + "</td>" +
      '<td class="num">' + fmtNum(s.density) + "</td>" +
      '<td class="num">' + fmtNum(s.human) + "</td>" +
      '<td class="num">' + fmtNum(s.ai) + "</td>" +
      '<td class="num">' + (s.ratio ? esc(String(s.ratio)) + "×" : "—") + "</td>" +
      '<td><span class="badge lv-' + esc(s.level) + '">' + levelText(s.level) + "</span>" +
      (s.stale ? ' <span class="small dim">过期</span>' : "") +
      (s.conditional ? ' <span class="small dim">条件</span>' : "") +
      "</td>" +
      "<td>" + (s.focus ? '<span class="star">★</span>' : "") + "</td>" +
      "</tr>";
  }
  tbody.innerHTML = html || '<tr><td colspan="8" class="dim">没有命中任何规则（跳过区：代码/表格/公式/URL 不计）。</td></tr>';
  var trs = tbody.querySelectorAll("tr.clickable");
  for (var t = 0; t < trs.length; t++) {
    trs[t].addEventListener("click", function (e) {
      var rid = e.currentTarget.getAttribute("data-rid");
      state.activeRuleId = state.activeRuleId === rid ? null : rid;
      renderHighlight();
      var all = tbody.querySelectorAll("tr");
      for (var q = 0; q < all.length; q++) all[q].classList.remove("active");
      if (state.activeRuleId) e.currentTarget.classList.add("active");
    });
  }

  renderBars(rows, threshold);
  renderWatch(res);
  renderFormat(res.format || {});
  renderHighlight();
}

function levelText(lv) {
  return { normal: "正常", watch: "观察", elevated: "偏高", high: "高" }[lv] || lv || "正常";
}

function renderBars(rows, threshold) {
  var box = $("barChart");
  var html = "";
  for (var i = 0; i < rows.length && i < 40; i++) {
    var s = rows[i];
    var human = typeof s.human === "number" ? s.human : null;
    var ai = typeof s.ai === "number" ? s.ai : null;
    var scale = Math.max(s.density || 0, ai || 0, (human || 0) * (threshold || 2), 0.001);
    var w = Math.min(100, ((s.density || 0) / scale) * 100);
    var hm = human === null ? null : Math.min(100, (human / scale) * 100);
    var am = ai === null ? null : Math.min(100, (ai / scale) * 100);
    html +=
      '<div class="bar-row">' +
      '<div class="bar-name" title="' + esc(s.name) + '">' + esc(s.name) + "</div>" +
      '<div class="bar-track">' +
      '<div class="bar-fill lv-' + esc(s.level) + '" style="width:' + w.toFixed(1) + '%"></div>' +
      (hm === null ? "" : '<div class="bar-marker" style="left:' + hm.toFixed(1) + '%" title="人类基线"></div>') +
      (am === null ? "" : '<div class="bar-marker ai" style="left:' + am.toFixed(1) + '%" title="AI 基线"></div>') +
      "</div>" +
      '<div class="bar-val">' + fmtNum(s.density) + (human === null ? "" : " /h " + fmtNum(human)) + "</div>" +
      "</div>";
  }
  box.innerHTML = html || '<div class="dim small">无命中，不绘制。</div>';
}

function renderWatch(res) {
  var show = state.config ? !!state.config.showWatch : true;
  $("watchCollapse").style.display = show ? "" : "none";
  var list = res.watchlist || [];
  var html = "";
  for (var i = 0; i < list.length; i++) {
    var w = list[i];
    html +=
      '<div class="check-row"><span class="badge lv-watch">观察</span> <b>' + esc(w.name) + "</b>" +
      ' <span class="dim">命中 ' + w.hits + " ｜ 密度 " + fmtNum(w.density) + "</span>" +
      '<div class="small dim">' + esc(w.note || "") + "</div></div>";
  }
  $("watchList").innerHTML = html || '<div class="dim small">没有观察项。</div>';
}

function renderFormat(f) {
  var rows = [
    ["加粗数", f.boldCount],
    ["整句加粗数", f.boldFullSentenceCount],
    ["emoji 数", f.emojiCount],
    ["标题数", f.headingCount],
    ["列表行数", f.listLineCount],
    ["列表行占比", f.listLineRatio],
    ["段落数", f.paragraphCount],
    ["段落长度 CV", f.paragraphLenCV],
    ["句长 CV", f.sentenceLenCV],
    ["语气词密度（/千字）", f.modalParticleDensity],
    ["书面词密度（/千字）", f.writtenWordDensity]
  ];
  var html = "";
  for (var i = 0; i < rows.length; i++) {
    html += "<tr><td>" + esc(rows[i][0]) + '</td><td class="num">' + fmtNum(rows[i][1]) + "</td></tr>";
  }
  html += '<tr><td colspan="2" class="dim small">以上只展示不判定。</td></tr>';
  $("formatTable").querySelector("tbody").innerHTML = html;
}

function renderHighlight() {
  var res = state.scanResult;
  if (!res) return;
  var text = state.original;
  var spans = [];
  for (var i = 0; i < (res.stats || []).length; i++) {
    var s = res.stats[i];
    if (state.activeRuleId && s.id !== state.activeRuleId) continue;
    for (var j = 0; j < (s.spans || []).length; j++) {
      spans.push({
        start: s.spans[j].start,
        end: s.spans[j].end,
        id: s.id,
        level: s.level === "normal" ? "watch" : s.level
      });
    }
  }
  spans.sort(function (a, b) {
    return a.start - b.start || a.end - b.end;
  });
  var merged = [];
  for (var k = 0; k < spans.length; k++) {
    var sp = spans[k];
    var last = merged[merged.length - 1];
    if (last && sp.start < last.end) {
      if (sp.end > last.end) last.end = sp.end;
    } else {
      merged.push({ start: sp.start, end: sp.end, level: sp.level, id: sp.id });
    }
  }
  var html = "";
  var pos = 0;
  for (var m = 0; m < merged.length; m++) {
    var mu = merged[m];
    if (mu.start < pos) continue;
    html += esc(text.slice(pos, mu.start));
    html +=
      '<mark class="mk mk-' + esc(mu.level) + '" data-rule="' + esc(mu.id) + '">' +
      esc(text.slice(mu.start, mu.end)) +
      "</mark>";
    pos = mu.end;
  }
  html += esc(text.slice(pos));
  $("highlightView").innerHTML = html || '<span class="dim">（空）</span>';
}

// ---------- 改写 ----------

// 经 background 的 fetch 适配器：把 callModel 的请求翻译成 rewrite 消息
function makeBackgroundFetch(cfg) {
  return function (url, init) {
    return new Promise(function (resolve, reject) {
      var body = {};
      try {
        body = JSON.parse(init.body || "{}");
      } catch (e) {
        body = {};
      }
      var prompt = (body.messages && body.messages[0] && body.messages[0].content) || "";
      var payload = {
        prompt: prompt,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        apiType: cfg.apiType,
        modelName: cfg.modelName,
        timeoutMs: cfg.timeoutSec * 1000,
        temperature: body.temperature,
        maxTokens: body.max_tokens,
        cacheKey: cfg.cacheKey
      };
      if (init.signal) {
        if (init.signal.aborted) {
          reject(new Error("模型调用超时"));
          return;
        }
        init.signal.addEventListener("abort", function () {
          reject(new Error("模型调用超时"));
        });
      }
      sendMsg({ type: "rewrite", payload: payload }).then(
        function (resp) {
          if (!resp || !resp.ok) {
            reject(new Error(resp && resp.error ? resp.error : "后台调用失败"));
            return;
          }
          if (resp.cached) state.bgCached = true;
          resolve({
            ok: true,
            status: 200,
            json: function () {
              return Promise.resolve({ choices: [{ message: { content: resp.text } }] });
            }
          });
        },
        function (err) {
          reject(err);
        }
      );
    });
  };
}

function doRewrite() {
  var res = doScan();
  if (!res) return;
  var text = state.original;
  var register = $("selRegister").value || "qa";
  var model = $("selModel").value || "unknown";
  readConfigForm();
  var cfg = state.config;

  banner("fallbackNote", "");
  banner("cacheNote", "");
  $("rewriteArea").hidden = true;

  // 自定义 Base URL 时先检查/申请站点权限（best-effort）
  var origin = "";
  try {
    origin = new URL(cfg.baseUrl).origin;
  } catch (e) {
    origin = "";
  }

  setBusy(true, "改写中（经后台调用模型）…");
  var permPromise = origin
    ? sendMsg({ type: "checkPermission", origin: origin })
        .then(function (r) {
          if (r && r.granted) return true;
          return sendMsg({ type: "requestPermission", origin: origin }).then(function (r2) {
            return r2 && r2.granted;
          });
        })
        .catch(function () {
          return true;
        })
    : Promise.resolve(true);

  var cacheKeySource = [text, register, model, cfg.modelName || ""].join("|");
  var fetchCfg = {
    apiKey: cfg.apiKey,
    baseUrl: cfg.baseUrl,
    apiType: cfg.apiType,
    modelName: cfg.modelName,
    timeoutSec: cfg.timeoutSec,
    cacheKey: simpleHash(cacheKeySource)
  };
  state.bgCached = false;

  permPromise
    .then(function () {
      return window.DeaiRewrite.rewrite(text, res, {
        register: register,
        model: model,
        apiKey: cfg.apiKey,
        baseUrl: cfg.baseUrl,
        apiType: cfg.apiType,
        modelName: cfg.modelName,
        timeoutMs: cfg.timeoutSec * 1000,
        rules: rulesWithToggles(),
        extraNote: cfg.allowTodo ? "" : "【禁用待补标记】不要输出【待补】小节，需要作者补充的信息写进【需作者确认】。",
        fetchImpl: makeBackgroundFetch(fetchCfg)
      });
    })
    .then(function (result) {
      setBusy(false);
      if (!result) return;
      if (result.cached || state.bgCached) result.cached = true;

      if (result.fallbackReason) {
        var isInfo = /无需改写/.test(result.fallbackReason);
        banner(
          "fallbackNote",
          (isInfo ? "" : "改写被放弃：") + result.fallbackReason + (isInfo ? "" : "，已回退原文"),
          isInfo ? "info" : "warn"
        );
        setStatus("已安全回退原文。");
        return;
      }
      if (!result.ok) {
        banner("fallbackNote", "改写被放弃：未知原因，已回退原文", "warn");
        return;
      }

      state.rewritten = result.text;
      if (result.cached) banner("cacheNote", "命中缓存，未产生费用", "ok");
      renderRewrite(result);
      setStatus("改写完成（已通过三层校验 + 闭环复扫）。");
    })
    .catch(function (err) {
      setBusy(false);
      banner("fallbackNote", "改写被放弃：" + (err && err.message ? err.message : err) + "，已回退原文", "warn");
      setStatus("改写出错，已回退原文。", true);
    });
}

function renderRewrite(result) {
  $("rewriteArea").hidden = false;
  var onlyFinal = $("chkOnlyFinal").checked;
  $("finalText").value = result.text || "";

  if (onlyFinal) {
    $("rewriteReport").innerHTML = "";
    $("diffWrap").hidden = true;
    $("btnToggleDiff").style.display = "none";
    return;
  }
  $("btnToggleDiff").style.display = "";

  var report = result.report || {};
  var html = "";
  if (report.changes && report.changes.length) {
    html += "<h3>改动说明（最多 8 条）</h3><ul>";
    for (var i = 0; i < report.changes.length; i++) {
      html += "<li>" + esc(report.changes[i]) + "</li>";
    }
    html += "</ul>";
  }
  function section(title, arr, kind) {
    if (!arr || !arr.length) return "";
    var s = '<details class="collapse"><summary>' + title + "</summary><div class=\"body\"><ul>";
    for (var j = 0; j < arr.length; j++) s += "<li>" + esc(arr[j]) + "</li>";
    return s + "</ul></div></details>";
  }
  if (state.config.showWatch) html += section("【观察项】命中但未改，供你决定", report.watch);
  html += section("【需作者确认】强度/事实/主次拿不准的地方", report.confirm);
  if (state.config.allowTodo) html += section("【待补】需要你补充的材料", report.todo);
  if (result.rescan && result.rescan.resolved && result.rescan.resolved.length) {
    html += '<div class="banner ok">闭环复扫：' + esc(result.rescan.resolved.join("、")) + " 密度已下降，未引入新的偏高项。</div>";
  }
  if (result.violations && result.violations.length) {
    html += '<div class="banner warn">校验提示：' + esc(JSON.stringify(result.violations).slice(0, 300)) + "</div>";
  }
  $("rewriteReport").innerHTML = html;
  renderDiff(state.original, result.text);
  $("diffWrap").hidden = true;
}

// ---------- diff（行级 LCS，过大时降级） ----------

function renderDiff(before, after) {
  var a = String(before || "").split("\n");
  var b = String(after || "").split("\n");
  var box = $("diffView");
  if (a.length * b.length > 400000) {
    box.innerHTML = '<div class="dim small" style="padding:8px">文本过长，diff 已简化：请直接对照上方终稿与原输入。</div>';
    return;
  }
  // LCS DP
  var n = a.length;
  var m = b.length;
  var dp = [];
  for (var i = 0; i <= n; i++) dp.push(new Uint32Array(m + 1));
  for (var i2 = n - 1; i2 >= 0; i2--) {
    for (var j2 = m - 1; j2 >= 0; j2--) {
      dp[i2][j2] = a[i2] === b[j2] ? dp[i2 + 1][j2 + 1] + 1 : Math.max(dp[i2 + 1][j2], dp[i2][j2 + 1]);
    }
  }
  var rows = [];
  var x = 0;
  var y = 0;
  while (x < n && y < m) {
    if (a[x] === b[y]) {
      rows.push({ t: "same", a: a[x], b: b[y] });
      x++;
      y++;
    } else if (dp[x + 1][y] >= dp[x][y + 1]) {
      rows.push({ t: "del", a: a[x], b: null });
      x++;
    } else {
      rows.push({ t: "ins", a: null, b: b[y] });
      y++;
    }
  }
  while (x < n) rows.push({ t: "del", a: a[x++], b: null });
  while (y < m) rows.push({ t: "ins", a: null, b: b[y++] });

  var html = "<table>";
  var ln = 0;
  var rn = 0;
  for (var k = 0; k < rows.length; k++) {
    var r = rows[k];
    var lcell = r.a === null ? "" : esc(r.a);
    var rcell = r.b === null ? "" : esc(r.b);
    html +=
      '<tr class="' + (r.t === "same" ? "" : r.t) + '">' +
      '<td class="gut">' + (r.a === null ? "" : ++ln) + "</td>" +
      "<td>" + (lcell || "&nbsp;") + "</td>" +
      '<td class="gut">' + (r.b === null ? "" : ++rn) + "</td>" +
      "<td>" + (rcell || "&nbsp;") + "</td>" +
      "</tr>";
  }
  box.innerHTML = html + "</table>";
}

// ---------- L1 生成侧提示词 ----------

function injectPromptA() {
  var prompt = "";
  try {
    prompt = window.DeaiRewrite.generationPrompt();
  } catch (err) {
    setStatus("生成侧提示词加载失败：" + (err && err.message ? err.message : err), true);
    return;
  }
  var write = navigator.clipboard && navigator.clipboard.writeText
    ? navigator.clipboard.writeText(prompt)
    : Promise.reject(new Error("clipboard 不可用"));
  write
    .then(function () {
      if (!state.config.l1Enabled) {
        toast("已复制（L1 已关闭，未注入页面）");
        return;
      }
      return getActiveTab().then(function (tab) {
        if (!tab) {
          toast("已复制（未找到活动标签页）");
          return;
        }
        return sendTab(tab.id, { type: "insertPromptA", prompt: prompt })
          .then(function (r) {
            toast(r && r.ok ? "已复制并注入输入框" : "已复制（当前页没有输入框）");
          })
          .catch(function () {
            toast("已复制（当前页不支持注入）");
          });
      });
    })
    .catch(function () {
      toast("复制失败，请手动复制（打开设置页可见提示词）");
    });
}

function getActiveTab() {
  return new Promise(function (resolve) {
    try {
      chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
        if (chrome.runtime.lastError || !tabs || !tabs.length) resolve(null);
        else resolve(tabs[0]);
      });
    } catch (err) {
      resolve(null);
    }
  });
}

// ---------- 抓取 / 剪贴板 ----------

function grabCurrent() {
  setBusy(true, "抓取中…");
  getActiveTab()
    .then(function (tab) {
      if (!tab) throw new Error("没有活动标签页");
      return sendTab(tab.id, { type: "grab" }).catch(function () {
        // 内容脚本可能未注入（非白名单站点）：用 activeTab 动态注入后重试
        return new Promise(function (resolve, reject) {
          try {
            chrome.scripting.executeScript(
              { target: { tabId: tab.id }, files: ["src/content.js"] },
              function () {
                if (chrome.runtime.lastError) {
                  reject(new Error(chrome.runtime.lastError.message));
                } else {
                  resolve(sendTab(tab.id, { type: "grab" }));
                }
              }
            );
          } catch (err) {
            reject(err);
          }
        });
      });
    })
    .then(function (r) {
      setBusy(false);
      if (r && r.ok && r.text) {
        $("inputText").value = r.text;
        setStatus("已抓取 " + (r.site || "") + " 的最后一条回复（共 " + r.text.length + " 字符）。");
        doScan();
      } else {
        setStatus("抓取失败：" + (r && r.error ? r.error : "当前页面不支持，请手动粘贴"), true);
      }
    })
    .catch(function (err) {
      setBusy(false);
      setStatus("抓取失败：" + (err && err.message ? err.message : err) + "（当前页面不支持，请手动粘贴）", true);
    });
}

function pasteClipboard() {
  if (!navigator.clipboard || !navigator.clipboard.readText) {
    setStatus("此环境不支持读取剪贴板，请直接 Ctrl+V 粘贴到输入框。", true);
    return;
  }
  navigator.clipboard
    .readText()
    .then(function (t) {
      if (t) {
        $("inputText").value = t;
        setStatus("已粘贴剪贴板文本（" + t.length + " 字符）。");
      } else {
        setStatus("剪贴板是空的。", true);
      }
    })
    .catch(function () {
      setStatus("读取剪贴板被拒绝，请直接 Ctrl+V 粘贴到输入框。", true);
    });
}

// ---------- 规则体检 ----------

function runRulecheck() {
  setBusy(true, "跑内置语料中…");
  var names = ["human-zh.json", "human-en.json", "ai-zh.json", "ai-en.json"];
  Promise.all(
    names.map(function (n) {
      return fetch(chrome.runtime.getURL("src/corpus/" + n)).then(function (r) {
        return r.json();
      });
    })
  )
    .then(function (all) {
      var humanDocs = (all[0] || []).concat(all[1] || []);
      var aiDocs = (all[2] || []).concat(all[3] || []);
      var out = window.DeaiRulecheck.rulecheck(humanDocs, aiDocs, { rules: rulesWithToggles() });
      renderRulecheck(out);
      setBusy(false);
    })
    .catch(function (err) {
      setBusy(false);
      setStatus("规则体检出错：" + (err && err.message ? err.message : err), true);
    });
}

function renderRulecheck(out) {
  $("rulecheckArea").hidden = false;
  var s = out.summary || {};
  $("rulecheckSummary").innerHTML =
    "真人语料 " + s.humanDocs + " 段，其中被判偏高 " + s.humanFlaggedDocs + " 段 → 文档级误报率 <b>" +
    (s.docFpRate * 100).toFixed(1) + "%</b>（要求 ≤5%）；AI 语料 " + s.aiDocs + " 段。";
  var html = "";
  for (var i = 0; i < (out.rules || []).length; i++) {
    var r = out.rules[i];
    html +=
      "<tr><td>" + esc(r.id + (r.variantId ? "/" + r.variantId : "") + " " + (r.name || "")) + "</td>" +
      '<td class="num">' + (r.fpRate * 100).toFixed(1) + "%</td>" +
      '<td class="num">' + (r.detectionRate * 100).toFixed(1) + "%</td>" +
      "<td>" + esc(r.suggestion || "") + "</td></tr>";
  }
  $("rulecheckTable").querySelector("tbody").innerHTML = html;
  $("rulecheckArea").scrollIntoView({ behavior: "smooth" });
}

// ---------- 事件绑定与初始化 ----------

function bindEvents() {
  $("btnScan").addEventListener("click", function () {
    if (doScan()) setStatus("扫描完成。点击表格行可高亮命中位置。");
  });
  $("btnRewrite").addEventListener("click", doRewrite);
  $("btnGrab").addEventListener("click", grabCurrent);
  $("btnPaste").addEventListener("click", pasteClipboard);
  $("btnClear").addEventListener("click", function () {
    $("inputText").value = "";
    state.original = "";
    state.scanResult = null;
    $("scanArea").hidden = true;
    $("rewriteArea").hidden = true;
    banner("fallbackNote", "");
    banner("cacheNote", "");
    setStatus("已清空。");
  });
  $("btnPromptA").addEventListener("click", injectPromptA);
  $("btnL1Toggle").addEventListener("click", function () {
    state.config.l1Enabled = !state.config.l1Enabled;
    $("btnL1Toggle").textContent = state.config.l1Enabled ? "L1：开" : "L1：关";
    saveConfigToStore(state.config);
    toast(state.config.l1Enabled ? "L1 生成侧注入已开启" : "L1 生成侧注入已关闭");
  });
  $("btnRulecheck").addEventListener("click", runRulecheck);
  $("btnSettings").addEventListener("click", function () {
    try {
      chrome.runtime.openOptionsPage();
    } catch (err) {
      setStatus("无法打开设置页：" + err, true);
    }
  });
  $("btnOpenOptions").addEventListener("click", function () {
    try {
      chrome.runtime.openOptionsPage();
    } catch (err) {
      setStatus("无法打开设置页：" + err, true);
    }
  });
  $("btnSaveConfig").addEventListener("click", function () {
    saveConfig(true);
  });
  $("btnCopyFinal").addEventListener("click", function () {
    var t = $("finalText").value;
    if (!t) return;
    (navigator.clipboard && navigator.clipboard.writeText
      ? navigator.clipboard.writeText(t)
      : Promise.reject()
    )
      .then(function () {
        toast("终稿已复制");
      })
      .catch(function () {
        $("finalText").select();
        toast("请按 Ctrl+C 复制");
      });
  });
  $("btnRevert").addEventListener("click", function () {
    $("inputText").value = state.original;
    $("scanArea").hidden = true;
    $("rewriteArea").hidden = true;
    state.scanResult = null;
    banner("fallbackNote", "");
    banner("cacheNote", "");
    setStatus("已回退原文。");
    toast("已回退原文");
  });
  $("btnToggleDiff").addEventListener("click", function () {
    var w = $("diffWrap");
    w.hidden = !w.hidden;
  });
  $("chkOnlyFinal").addEventListener("change", function () {
    state.config.onlyFinal = $("chkOnlyFinal").checked;
    saveConfigToStore(state.config);
    if (state.rewritten && !$("rewriteArea").hidden) {
      $("rewriteReport").innerHTML = $("chkOnlyFinal").checked ? "" : $("rewriteReport").innerHTML;
      $("diffWrap").hidden = true;
    }
  });
}

function init() {
  bindEvents();
  Promise.all([loadRules(), loadConfig()])
    .then(function (pair) {
      state.config = mergeConfig(pair[1].deaiConfig);
      fillSelects();
      fillConfigForm();
      // 从弹窗来的待处理文本：自动填入并扫描
      try {
        chrome.storage.session.get("pendingText", function (data) {
          void chrome.runtime.lastError;
          if (data && data.pendingText) {
            $("inputText").value = data.pendingText;
            chrome.storage.session.remove("pendingText");
            doScan();
            setStatus("已接收弹窗抓取的文本并完成扫描。");
          }
        });
      } catch (err) {
        /* storage.session 不可用则忽略 */
      }
    })
    .catch(function (err) {
      setStatus("初始化失败：" + (err && err.message ? err.message : err), true);
    });
}

document.addEventListener("DOMContentLoaded", init);
