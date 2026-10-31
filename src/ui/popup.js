/**
 * popup.js —— 弹窗：显示当前站点；打开侧栏 / 抓取并扫描 / 注入生成侧提示词
 * 「抓取并扫描」= 向 content script 抓文本 → 存 chrome.storage.session.pendingText → 打开侧栏，
 * 面板载入时自动填入并扫描。
 */

"use strict";

function $(id) {
  return document.getElementById(id);
}

function setStatus(msg, isErr) {
  var el = $("status");
  el.textContent = msg || "";
  el.className = "status" + (isErr ? " err" : "");
}

function sendTab(tabId, msg) {
  return new Promise(function (resolve, reject) {
    try {
      chrome.tabs.sendMessage(tabId, msg, function (resp) {
        if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
        else resolve(resp);
      });
    } catch (err) {
      reject(err);
    }
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

// 打开侧栏：必须在用户手势下调用 sidePanel.open（popup 点击即手势）
function openSidePanel() {
  return new Promise(function (resolve) {
    try {
      chrome.windows.getCurrent(function (win) {
        if (chrome.runtime.lastError || !win) {
          resolve(false);
          return;
        }
        try {
          var p = chrome.sidePanel.open({ windowId: win.id });
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
      });
    } catch (err) {
      resolve(false);
    }
  });
}

function setSession(key, value) {
  return new Promise(function (resolve) {
    try {
      var obj = {};
      obj[key] = value;
      chrome.storage.session.set(obj, function () {
        void chrome.runtime.lastError;
        resolve();
      });
    } catch (err) {
      resolve();
    }
  });
}

function init() {
  // 当前站点
  getActiveTab().then(function (tab) {
    if (tab && tab.url) {
      try {
        $("siteLine").textContent = "当前站点：" + new URL(tab.url).hostname;
      } catch (e) {
        $("siteLine").textContent = "当前站点：" + tab.url.slice(0, 40);
      }
    } else {
      $("siteLine").textContent = "当前站点：未知";
    }
  });

  $("btnOpenPanel").addEventListener("click", function () {
    openSidePanel().then(function (ok) {
      if (!ok) setStatus("无法打开侧栏（Chrome 116+ 需要 sidePanel 权限）", true);
      else window.close();
    });
  });

  $("btnGrabScan").addEventListener("click", function () {
    setStatus("抓取中…");
    getActiveTab()
      .then(function (tab) {
        if (!tab) throw new Error("没有活动标签页");
        return sendTab(tab.id, { type: "grab" }).catch(function (err) {
          throw new Error("当前页面不支持抓取（仅支持 ChatGPT / Claude / Gemini / DeepSeek / Kimi / 通义 / 豆包），请到侧栏手动粘贴");
        });
      })
      .then(function (r) {
        if (!r || !r.ok || !r.text) throw new Error(r && r.error ? r.error : "抓取失败");
        return setSession("pendingText", r.text).then(function () {
          return openSidePanel();
        });
      })
      .then(function (ok) {
        if (ok) {
          setStatus("已抓取并送入侧栏扫描。");
          setTimeout(function () {
            window.close();
          }, 300);
        } else {
          setStatus("已抓取，但无法打开侧栏", true);
        }
      })
      .catch(function (err) {
        setStatus(err && err.message ? err.message : String(err), true);
      });
  });

  $("btnPromptA").addEventListener("click", function () {
    // 从 core 取生成侧提示词（popup 不加载 core，直接读 prompts.js 的 PROMPT_A 需要脚本；
    // 为保持轻量，这里通过 background 无从取，改为向侧栏同一逻辑：直接加载 prompts.js）
    var s = document.createElement("script");
    s.src = "../core/prompts.js";
    s.onload = function () {
      var prompt = "";
      try {
        prompt = (window.DeaiPrompts && window.DeaiPrompts.buildGenerationSystemPrompt("")) || "";
      } catch (e) {
        prompt = "";
      }
      if (!prompt) {
        setStatus("提示词加载失败", true);
        return;
      }
      (navigator.clipboard && navigator.clipboard.writeText
        ? navigator.clipboard.writeText(prompt)
        : Promise.reject()
      )
        .then(function () {
          setStatus("生成侧提示词已复制。");
          return getActiveTab();
        })
        .then(function (tab) {
          if (!tab) return;
          return sendTab(tab.id, { type: "insertPromptA", prompt: prompt })
            .then(function (r) {
              setStatus(r && r.ok ? "已复制并注入当前页输入框" : "已复制（当前页没有输入框）");
            })
            .catch(function () {
              setStatus("已复制（当前页不支持注入）");
            });
        })
        .catch(function () {
          setStatus("已尝试复制（如失败请到侧栏复制）", true);
        });
    };
    s.onerror = function () {
      setStatus("提示词脚本加载失败", true);
    };
    document.body.appendChild(s);
  });
}

document.addEventListener("DOMContentLoaded", init);
