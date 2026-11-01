/**
 * content.js —— 内容脚本（注入在常见大模型对话站点）
 * 消息：
 *  {type:'grab'}             抓取当前页面「最后一条 AI 回复」的文本
 *  {type:'insertPromptA', prompt}  把生成侧提示词 A 前置插入页面输入框（不覆盖已有内容）
 * 抓不到返回 {ok:false}，绝不抛错打断页面。
 */

"use strict";

// ---------- 站点选择器（每个站点 2–3 个候选，逐个回退） ----------

var SITE_SELECTORS = {
  "chatgpt.com": ['[data-message-author-role="assistant"]', 'div[data-message-author-role]', ".markdown.prose"],
  "chat.openai.com": ['[data-message-author-role="assistant"]', 'div[data-message-author-role]', ".markdown.prose"],
  "claude.ai": [".font-claude-message", '[data-testid="assistant-message"]', ".claude-message"],
  "gemini.google.com": ["model-response", "message-content", ".model-response-text"],
  "chat.deepseek.com": [".ds-markdown", '[class*="markdown"]', '[class*="answer"]'],
  "www.kimi.com": ['.segment-assistant', '[class*="assistant"]', '[class*="answer"]'],
  "kimi.moonshot.cn": ['.segment-assistant', '[class*="assistant"]', '[class*="answer"]'],
  "www.tongyi.com": ['.bubble-content--chat', '[class*="bubble"]', '[class*="answer"]'],
  "tongyi.aliyun.com": ['.bubble-content--chat', '[class*="bubble"]', '[class*="answer"]'],
  "www.doubao.com": ['.message-box', '[class*="answer"]', '[class*="response"]'],
  "doubao.com": ['.message-box', '[class*="answer"]', '[class*="response"]']
};

function hostKey(hostname) {
  if (SITE_SELECTORS[hostname]) return hostname;
  // 去掉 www. 再试
  var alt = hostname.replace(/^www\./, "");
  if (SITE_SELECTORS[alt]) return alt;
  if (SITE_SELECTORS["www." + alt]) return "www." + alt;
  return null;
}

function cleanText(t) {
  return String(t || "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function grabFromSelectors(selectors) {
  var best = "";
  for (var i = 0; i < selectors.length; i++) {
    var nodes;
    try {
      nodes = document.querySelectorAll(selectors[i]);
    } catch (err) {
      continue;
    }
    if (!nodes || !nodes.length) continue;
    // 取最后一个匹配（最后一条回复），文本太短则尝试倒数第二个
    for (var j = nodes.length - 1; j >= 0 && j >= nodes.length - 3; j--) {
      var txt = cleanText(nodes[j].innerText || nodes[j].textContent || "");
      if (txt.length > 40) return txt;
    }
    var lastTxt = cleanText(nodes[nodes.length - 1].innerText || "");
    if (lastTxt.length > best.length) best = lastTxt;
  }
  return best;
}

function grabGeneric() {
  // 通用回退：main 里最后一个 article / 最长的长 div
  var main = document.querySelector("main") || document.body;
  if (!main) return "";
  var arts = main.querySelectorAll("article");
  if (arts.length) {
    var t = cleanText(arts[arts.length - 1].innerText || "");
    if (t.length > 40) return t;
  }
  var cands = main.querySelectorAll("div, section");
  var best = "";
  for (var i = 0; i < cands.length; i++) {
    var el = cands[i];
    // 只要叶子性较强的容器，避免把整页抓进来
    if (el.children.length > 8) continue;
    var txt = cleanText(el.innerText || "");
    if (txt.length > 80 && txt.length < 20000 && txt.length > best.length) best = txt;
  }
  return best;
}

function grab() {
  try {
    var key = hostKey(location.hostname);
    var text = "";
    if (key) text = grabFromSelectors(SITE_SELECTORS[key]);
    if (!text) text = grabGeneric();
    if (!text) return { ok: false, error: "没有找到 AI 回复文本" };
    return { ok: true, text: text, site: key || location.hostname };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// ---------- 注入提示词 A（前置插入，不覆盖已有内容） ----------

function findInputBox() {
  // 候选：可见 textarea → contenteditable 输入区，取面积最大的
  var sels = [
    'textarea',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"]'
  ];
  var best = null;
  var bestArea = 0;
  for (var i = 0; i < sels.length; i++) {
    var nodes = document.querySelectorAll(sels[i]);
    for (var j = 0; j < nodes.length; j++) {
      var el = nodes[j];
      if (el.offsetParent === null && getComputedStyle(el).position !== "fixed") continue; // 不可见
      if (el.disabled || el.readOnly) continue;
      var r = el.getBoundingClientRect();
      var area = r.width * r.height;
      if (area > bestArea) {
        bestArea = area;
        best = el;
      }
    }
    if (best) break;
  }
  return best;
}

function insertPromptA(prompt) {
  try {
    var el = findInputBox();
    if (!el) return { ok: false, error: "没有找到输入框" };
    var prefix = String(prompt || "").trim();
    if (!prefix) return { ok: false, error: "提示词为空" };
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      var old = el.value || "";
      if (old.indexOf(prefix.slice(0, 30)) === 0) return { ok: true, already: true }; // 已注入过
      el.value = prefix + "\n\n" + old;
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    } else {
      var oldHtml = el.innerText || el.textContent || "";
      if (oldHtml.indexOf(prefix.slice(0, 30)) === 0) return { ok: true, already: true };
      el.textContent = prefix + "\n\n" + oldHtml;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    }
    el.focus();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err && err.message ? err.message : err) };
  }
}

// ---------- 消息监听 ----------

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  if (!msg || typeof msg.type !== "string") return false;
  if (msg.type === "grab") {
    sendResponse(grab());
    return false;
  }
  if (msg.type === "insertPromptA") {
    sendResponse(insertPromptA(msg.prompt));
    return false;
  }
  return false;
});
