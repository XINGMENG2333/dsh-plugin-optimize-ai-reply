/**
 * background.js —— MV3 service worker
 * 职责：
 *  1. 模型 API 调用代理（扩展页面直连会被 CORS 拦，所有出网统一走这里）
 *  2. 站点权限查询/申请（自定义 Base URL 时用 optional_host_permissions）
 *  3. 侧栏打开（openPanel 消息；popup 直接调 sidePanel.open 亦可）
 *  4. 改写结果持久缓存（chrome.storage.local，上限 200 条，按插入序淘汰）
 * 与 src/core/rewrite.js 的 callModel 保持同一请求体形状（OpenAI 兼容 / Anthropic）。
 */

"use strict";

// ---------- 缓存（chrome.storage.local，键 = 文本哈希） ----------

var CACHE_STORE_KEY = "rewriteCache"; // { hashKey: { text, at } }
var CACHE_MAX = 200;

function storageGet(key) {
  return new Promise(function (resolve) {
    try {
      chrome.storage.local.get(key, function (data) {
        if (chrome.runtime.lastError) resolve({});
        else resolve(data || {});
      });
    } catch (err) {
      resolve({});
    }
  });
}

function storageSet(obj) {
  return new Promise(function (resolve) {
    try {
      chrome.storage.local.set(obj, function () {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch (err) {
      resolve();
    }
  });
}

async function cacheGet(key) {
  if (!key) return null;
  var data = await storageGet(CACHE_STORE_KEY);
  var map = data[CACHE_STORE_KEY] || {};
  var hit = map[key];
  return hit && typeof hit.text === "string" ? hit.text : null;
}

async function cachePut(key, text) {
  if (!key || typeof text !== "string") return;
  var data = await storageGet(CACHE_STORE_KEY);
  var map = data[CACHE_STORE_KEY] || {};
  // 先删后插，刷新插入序
  if (map[key]) delete map[key];
  map[key] = { text: text, at: Date.now() };
  var keys = Object.keys(map);
  // 超出上限按插入序（Object.keys 顺序）淘汰最旧
  while (keys.length > CACHE_MAX) {
    delete map[keys.shift()];
  }
  var out = {};
  out[CACHE_STORE_KEY] = map;
  await storageSet(out);
}

async function cacheClear() {
  var out = {};
  out[CACHE_STORE_KEY] = {};
  await storageSet(out);
}

// ---------- 模型调用（请求体与 rewrite.js callModel 一致） ----------

/**
 * callModelApi(payload) -> Promise<{ok, text} | {ok:false, error}>
 * payload: { prompt, apiKey, baseUrl, apiType, modelName, timeoutMs, temperature, maxTokens }
 */
function callModelApi(payload) {
  var apiType = payload.apiType || "openai";
  var url, headers, body;

  if (apiType === "anthropic") {
    url = (payload.baseUrl || "https://api.anthropic.com").replace(/\/$/, "") + "/v1/messages";
    headers = {
      "Content-Type": "application/json",
      "x-api-key": payload.apiKey || "",
      "anthropic-version": "2023-06-01"
    };
    body = {
      model: payload.modelName || "claude-sonnet-4-5",
      max_tokens: payload.maxTokens || 4096,
      system: "你是文本改写器。严格按用户给出的格式输出。",
      messages: [{ role: "user", content: payload.prompt || "" }]
    };
  } else {
    url = (payload.baseUrl || "https://api.openai.com/v1").replace(/\/$/, "") + "/chat/completions";
    headers = {
      "Content-Type": "application/json",
      Authorization: "Bearer " + (payload.apiKey || "")
    };
    body = {
      model: payload.modelName || "gpt-4o",
      temperature: payload.temperature === undefined ? 0.3 : payload.temperature,
      messages: [{ role: "user", content: payload.prompt || "" }]
    };
  }

  var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  var timer = null;
  if (controller) {
    timer = setTimeout(function () {
      controller.abort();
    }, payload.timeoutMs || 120000);
  }

  return fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(body),
    signal: controller ? controller.signal : undefined
  })
    .then(function (res) {
      if (timer) clearTimeout(timer);
      if (!res.ok) {
        return res
          .text()
          .catch(function () {
            return "";
          })
          .then(function (t) {
            var detail = "";
            try {
              var j = JSON.parse(t);
              detail = (j && (j.error && j.error.message || j.message)) || "";
            } catch (e) {
              detail = t ? String(t).slice(0, 160) : "";
            }
            throw new Error("API 返回 " + res.status + (detail ? "：" + detail : ""));
          });
      }
      return res.json();
    })
    .then(function (data) {
      if (data && data.choices && data.choices[0] && data.choices[0].message) {
        return { ok: true, text: data.choices[0].message.content };
      }
      if (data && data.content && data.content[0] && data.content[0].text) {
        return { ok: true, text: data.content[0].text };
      }
      throw new Error("API 响应结构无法解析");
    })
    .catch(function (err) {
      if (timer) clearTimeout(timer);
      var msg = err && err.name === "AbortError" ? "模型调用超时" : (err && err.message) || String(err);
      return { ok: false, error: msg };
    });
}

// ---------- 权限（自定义 Base URL 需要对应 origin 的 host 权限） ----------

function originToPattern(origin) {
  try {
    var u = new URL(origin);
    return u.origin + "/*";
  } catch (err) {
    return String(origin || "").replace(/\/.*$/, "") + "/*";
  }
}

function permissionsContains(origin) {
  return new Promise(function (resolve) {
    var pattern = originToPattern(origin);
    try {
      chrome.permissions.contains({ origins: [pattern] }, function (granted) {
        if (chrome.runtime.lastError) resolve(false);
        else resolve(!!granted);
      });
    } catch (err) {
      resolve(false);
    }
  });
}

function permissionsRequest(origin) {
  return new Promise(function (resolve) {
    var pattern = originToPattern(origin);
    try {
      chrome.permissions.request({ origins: [pattern] }, function (granted) {
        if (chrome.runtime.lastError) resolve(false);
        else resolve(!!granted);
      });
    } catch (err) {
      resolve(false);
    }
  });
}

// ---------- 侧栏 ----------

function openPanelFor(sender) {
  return new Promise(function (resolve) {
    var windowId = sender && sender.tab && sender.tab.windowId;
    var doOpen = function (id) {
      try {
        var p = chrome.sidePanel.open({ windowId: id });
        if (p && p.then) {
          p.then(function () {
            resolve(true);
          }).catch(function () {
            resolve(false);
          });
        } else {
          resolve(true);
        }
      } catch (err) {
        resolve(false);
      }
    };
    if (windowId !== undefined) {
      doOpen(windowId);
    } else {
      try {
        chrome.windows.getCurrent(function (win) {
          if (chrome.runtime.lastError || !win) resolve(false);
          else doOpen(win.id);
        });
      } catch (err) {
        resolve(false);
      }
    }
  });
}

// 行为设置：有 popup，不自动开侧栏
try {
  if (chrome.sidePanel && chrome.sidePanel.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(function () {});
  }
} catch (err) {
  /* 旧版 Chrome 无此 API，忽略 */
}

// ---------- 消息路由 ----------

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== "string") return false;

  if (msg.type === "rewrite") {
    var payload = msg.payload || {};
    if (!payload.prompt) {
      sendResponse({ ok: false, error: "缺少 prompt" });
      return false;
    }
    (async function () {
      // 1. 查持久缓存
      var cached = await cacheGet(payload.cacheKey);
      if (cached !== null) {
        sendResponse({ ok: true, text: cached, cached: true });
        return;
      }
      // 2. 调模型
      var res = await callModelApi(payload);
      if (res.ok) {
        await cachePut(payload.cacheKey, res.text);
      }
      sendResponse(res);
    })();
    return true; // 异步 sendResponse
  }

  if (msg.type === "checkPermission") {
    permissionsContains(msg.origin).then(function (granted) {
      sendResponse({ ok: true, granted: granted });
    });
    return true;
  }

  if (msg.type === "requestPermission") {
    permissionsRequest(msg.origin).then(function (granted) {
      sendResponse({ ok: true, granted: granted });
    });
    return true;
  }

  if (msg.type === "openPanel") {
    openPanelFor(sender).then(function (ok) {
      sendResponse({ ok: ok });
    });
    return true;
  }

  if (msg.type === "clearCache") {
    cacheClear().then(function () {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === "cacheCount") {
    storageGet(CACHE_STORE_KEY).then(function (data) {
      var map = data[CACHE_STORE_KEY] || {};
      sendResponse({ ok: true, count: Object.keys(map).length });
    });
    return true;
  }

  return false;
});
