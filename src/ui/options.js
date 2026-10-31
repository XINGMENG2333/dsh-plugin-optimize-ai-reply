/**
 * options.js —— 设置页逻辑
 * 每项改动即存（chrome.storage.sync.deaiConfig）并显示「已保存」；
 * 规则开关全表、规则时效表、语料体检、缓存清空、恢复默认。
 */

"use strict";

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
  }, 2000);
}

function markSaved() {
  $("savedFlag").textContent = "已保存 " + new Date().toLocaleTimeString();
  clearTimeout(markSaved._t);
  markSaved._t = setTimeout(function () {
    $("savedFlag").textContent = "";
  }, 3000);
}

function sendMsg(msg) {
  return new Promise(function (resolve, reject) {
    try {
      chrome.runtime.sendMessage(msg, function (resp) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    } catch (err) {
      reject(err);
    }
  });
}

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

var state = { rules: null, config: null };

// ---------- 配置读写 ----------

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

function saveConfig() {
  return new Promise(function (resolve) {
    try {
      chrome.storage.sync.set({ deaiConfig: state.config }, function () {
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

// ---------- 表单 ----------

function fillForm() {
  var c = state.config;
  $("cfgApiKey").value = c.apiKey || "";
  $("cfgBaseUrl").value = c.baseUrl || DEFAULT_CONFIG.baseUrl;
  $("cfgApiType").value = c.apiType || "openai";
  $("cfgModelName").value = c.modelName || "";
  $("cfgTimeout").value = c.timeoutSec || 120;
  $("cfgThreshold").value = c.threshold || 2;
  $("cfgAllowTodo").checked = !!c.allowTodo;
  $("cfgShowWatch").checked = !!c.showWatch;
  $("cfgL1").checked = !!c.l1Enabled;
}

function bindForm() {
  var map = [
    ["cfgApiKey", "apiKey", "value"],
    ["cfgBaseUrl", "baseUrl", "value"],
    ["cfgApiType", "apiType", "value"],
    ["cfgModelName", "modelName", "value"],
    ["cfgTimeout", "timeoutSec", "number"],
    ["cfgThreshold", "threshold", "number"]
  ];
  for (var i = 0; i < map.length; i++) {
    (function (m) {
      $(m[0]).addEventListener("change", function () {
        state.config[m[1]] = m[2] === "number" ? Number($(m[0]).value) || DEFAULT_CONFIG[m[1]] : $(m[0]).value.trim();
        saveConfig().then(markSaved);
      });
    })(map[i]);
  }
  var checks = [
    ["cfgAllowTodo", "allowTodo"],
    ["cfgShowWatch", "showWatch"],
    ["cfgL1", "l1Enabled"]
  ];
  for (var j = 0; j < checks.length; j++) {
    (function (c) {
      $(c[0]).addEventListener("change", function () {
        state.config[c[1]] = $(c[0]).checked;
        saveConfig().then(markSaved);
      });
    })(checks[j]);
  }
}

// ---------- 规则开关 ----------

function renderRuleToggles() {
  var box = $("ruleToggles");
  if (!state.rules) return;
  var rules = state.rules.rules || [];
  var html = "";
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i];
    var on = state.config.ruleToggles[r.id] !== false;
    var isText = r.type === "text";
    html +=
      '<div class="check-row">' +
      '<input type="checkbox" id="tg_' + esc(r.id) + '"' + (on ? " checked" : "") + (isText ? " disabled" : "") + ' data-rid="' + esc(r.id) + '" />' +
      '<label for="tg_' + esc(r.id) + '"><span class="rid">' + esc(r.id) + "</span>" + esc(r.name) +
      ' <span class="dim small">[' + esc(r.group || "") + "｜" + esc(r.evidenceLevel || "") + "｜" + esc(r.judgment || "") + "]</span>" +
      (isText ? ' <span class="dim small">（禁用清单文本，无检测器）</span>' : "") +
      "</label></div>";
  }
  box.innerHTML = html;
  var inputs = box.querySelectorAll("input[type=checkbox][data-rid]");
  for (var k = 0; k < inputs.length; k++) {
    inputs[k].addEventListener("change", function (e) {
      var rid = e.target.getAttribute("data-rid");
      state.config.ruleToggles[rid] = e.target.checked;
      saveConfig().then(markSaved);
    });
  }
}

function renderAsOfTable() {
  var tbody = $("asOfTable").querySelector("tbody");
  if (!state.rules) return;
  var rules = state.rules.rules || [];
  var now = Date.now();
  var html = "";
  for (var i = 0; i < rules.length; i++) {
    var r = rules[i];
    var stale = false;
    if (r.asOf) {
      var t = Date.parse(r.asOf);
      if (!isNaN(t) && now - t > 183 * 24 * 3600 * 1000) stale = true; // 超 6 个月
    }
    html +=
      "<tr><td>" + esc(r.id + " " + r.name) + "</td>" +
      "<td>" + esc(r.group || "") + "</td>" +
      "<td>" + esc(r.evidenceLevel || "") + "</td>" +
      '<td class="num">' + esc(r.asOf || "—") + "</td>" +
      "<td>" +
      (stale ? '<span class="badge lv-watch">待复核（超 6 个月）</span>' : '<span class="badge lv-normal">有效</span>') +
      (r.evidenceStatus && r.evidenceStatus !== "ok" ? ' <span class="badge lv-elevated">' + esc(r.evidenceStatus) + "</span>" : "") +
      "</td></tr>";
  }
  tbody.innerHTML = html;
}

// ---------- 规则体检 ----------

function runRulecheck() {
  $("btnRulecheck").disabled = true;
  $("btnRulecheck").textContent = "跑语料中…";
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
      var clone = JSON.parse(JSON.stringify(state.rules));
      for (var i = 0; i < (clone.rules || []).length; i++) {
        if (state.config.ruleToggles[clone.rules[i].id] === false) clone.rules[i].enabled = false;
      }
      var out = window.DeaiRulecheck.rulecheck(humanDocs, aiDocs, { rules: clone });
      $("rulecheckArea").hidden = false;
      var s = out.summary || {};
      $("rulecheckSummary").innerHTML =
        "真人语料 " + s.humanDocs + " 段，被判偏高 " + s.humanFlaggedDocs + " 段 → 文档级误报率 <b>" +
        (s.docFpRate * 100).toFixed(1) + "%</b>（要求 ≤5%）；AI 语料 " + s.aiDocs + " 段。";
      var html = "";
      for (var j = 0; j < (out.rules || []).length; j++) {
        var r = out.rules[j];
        html +=
          "<tr><td>" + esc(r.id + (r.variantId ? "/" + r.variantId : "") + " " + (r.name || "")) + "</td>" +
          '<td class="num">' + (r.fpRate * 100).toFixed(1) + "%</td>" +
          '<td class="num">' + (r.detectionRate * 100).toFixed(1) + "%</td>" +
          "<td>" + esc(r.suggestion || "") + "</td></tr>";
      }
      $("rulecheckTable").querySelector("tbody").innerHTML = html;
    })
    .catch(function (err) {
      toast("规则体检出错：" + (err && err.message ? err.message : err));
    })
    .then(function () {
      $("btnRulecheck").disabled = false;
      $("btnRulecheck").textContent = "跑规则体检（内置 40 段真人 + 20 段 AI 语料）";
    });
}

function refreshCacheLine() {
  sendMsg({ type: "cacheCount" })
    .then(function (r) {
      $("cacheLine").textContent = "改写缓存条数：" + ((r && r.count) || 0) + "（上限 200，命中不重复计费）";
    })
    .catch(function () {
      $("cacheLine").textContent = "缓存状态不可用";
    });
}

// ---------- 初始化 ----------

function init() {
  Promise.all([
    fetch(chrome.runtime.getURL("src/core/rules.json")).then(function (r) {
      return r.json();
    }),
    loadConfig()
  ])
    .then(function (pair) {
      window.DEAI_RULES = pair[0];
      state.rules = pair[0];
      state.config = mergeConfig(pair[1].deaiConfig);
      fillForm();
      bindForm();
      renderRuleToggles();
      renderAsOfTable();
      refreshCacheLine();
    })
    .catch(function (err) {
      $("savedFlag").textContent = "初始化失败：" + (err && err.message ? err.message : err);
    });

  $("btnEnableAll").addEventListener("click", function () {
    state.config.ruleToggles = {};
    renderRuleToggles();
    saveConfig().then(markSaved);
  });

  $("btnDisableB").addEventListener("click", function () {
    var rules = (state.rules && state.rules.rules) || [];
    for (var i = 0; i < rules.length; i++) {
      if (rules[i].group === "B") state.config.ruleToggles[rules[i].id] = false;
    }
    renderRuleToggles();
    saveConfig().then(markSaved);
  });

  $("btnRulecheck").addEventListener("click", runRulecheck);

  $("btnClearCache").addEventListener("click", function () {
    sendMsg({ type: "clearCache" })
      .then(function () {
        toast("缓存已清空");
        refreshCacheLine();
      })
      .catch(function (err) {
        toast("清空失败：" + err.message);
      });
  });

  $("btnRestore").addEventListener("click", function () {
    state.config = mergeConfig({});
    fillForm();
    renderRuleToggles();
    saveConfig().then(function () {
      markSaved();
      toast("已恢复默认");
    });
  });
}

document.addEventListener("DOMContentLoaded", init);
