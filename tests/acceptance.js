/**
 * acceptance.js —— 验收测试（规格《去AI味插件-终极提示词-v2.md》验收标准 8 条）
 * 运行：node tests/acceptance.js
 * 1 误报：40 段真人语料（20 中 + 20 英）被判「偏高」比例 ≤ 5%
 * 2 检出：20 段无风格指令的典型 AI 输出，「偏高」比例 ≥ 70%
 * 3 事实：10 组含数字/剂量/URL/代码/引文的文本 verify 100% 通过，数字改动 0 处；篡改必拦
 * 4 强度：5 组强度篡改（可能vs会 / 相关vs导致 / 主次拉平 / 部分vs有效 / 删程度词）必须 fail 并回退原文
 * 5 安全：❌→文字否定、兜底提示与危险加粗保留；删兜底必拦
 * 6 闭环：坏改写（破折号→说白了）被拦下回退；好改写通过
 * 7 时效：as_of 12 个月前自动降级观察项
 * 8 降级：无 API Key / 错误地址 → 返回原文不崩
 */
"use strict";

var fs = require("fs");
var path = require("path");
var Scan = require(path.join(__dirname, "..", "src", "core", "scan.js"));
var Verify = require(path.join(__dirname, "..", "src", "core", "verify.js"));
var Rewrite = require(path.join(__dirname, "..", "src", "core", "rewrite.js"));
var Rulecheck = require(path.join(__dirname, "..", "src", "core", "rulecheck.js"));
var rules = require(path.join(__dirname, "..", "src", "core", "rules.json"));

var results = [];
var reportLines = ["# 验收测试报告（自动生成）", ""];

function record(name, pass, detail) {
  results.push({ name: name, pass: pass, detail: detail });
  console.log((pass ? "✓ PASS" : "✗ FAIL") + "｜" + name + (detail ? "｜" + detail : ""));
  reportLines.push("- **" + (pass ? "PASS" : "FAIL") + "** " + name + (detail ? "：" + detail : ""));
}

function loadCorpus(file) {
  return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "src", "corpus", file), "utf8"));
}

function mock(finalText) {
  return "［终稿］\n" + finalText + "\n---\n改动说明\n- 验收用模拟改写\n【观察项】无\n【需作者确认】无\n【待补】无";
}

function mockFromProtected(fn) {
  return function (protectedText) {
    return mock(fn(protectedText));
  };
}

var KIND_REGISTER = Rulecheck.KIND_REGISTER;

// ---------- 1 误报 ----------
var humanDocs = loadCorpus("human-zh.json").concat(loadCorpus("human-en.json")).map(function (d) {
  return { id: d.id, kind: d.kind, register: KIND_REGISTER[d.kind] || "qa", model: "unknown", text: d.text };
});

var humanFlagged = [];
for (var i = 0; i < humanDocs.length; i++) {
  var resH = Scan.scan(humanDocs[i].text, humanDocs[i].register, humanDocs[i].model, rules);
  if (Scan.documentFlag(resH).flagged) {
    var elevated = Scan.documentFlag(resH).elevated.map(function (x) {
      return x.id + (x.variantId ? "/" + x.variantId : "");
    });
    humanFlagged.push({ id: humanDocs[i].id, rules: elevated });
  }
}
var fpRate = humanFlagged.length / humanDocs.length;
record(
  "1 误报：40 段真人语料偏高比例 ≤ 5%",
  fpRate <= 0.05,
  "偏高 " + humanFlagged.length + "/40 = " + (fpRate * 100).toFixed(1) + "%" + (humanFlagged.length ? "（" + JSON.stringify(humanFlagged) + "）" : "")
);

// ---------- 2 检出 ----------
var aiDocs = loadCorpus("ai-zh.json").concat(loadCorpus("ai-en.json")).map(function (d) {
  return { id: d.id, model: d.model, register: "qa", text: d.text };
});
var aiFlagged = [];
for (var j = 0; j < aiDocs.length; j++) {
  var resA = Scan.scan(aiDocs[j].text, aiDocs[j].register, aiDocs[j].model, rules);
  if (Scan.documentFlag(resA).flagged) aiFlagged.push(aiDocs[j].id);
}
var detRate = aiFlagged.length / aiDocs.length;
record(
  "2 检出：20 段 AI 输出偏高比例 ≥ 70%",
  detRate >= 0.7,
  "检出 " + aiFlagged.length + "/20 = " + (detRate * 100).toFixed(0) + "%"
);

// ---------- 3 事实 ----------
var factFixtures = [
  {
    before: "剂量 500mg，每天 2 次，饭后服。有效率 82%（n=120）。",
    after: "剂量 500mg，每天 2 次，饭后服。有效率 82%（n=120）。"
  },
  {
    before: "详见 https://example.com/guide，报错信息是 Connection refused。",
    after: "报错信息是 Connection refused。详见 https://example.com/guide。"
  },
  {
    before: "用 `pip install -r requirements.txt` 安装，Python 3.12 起支持。",
    after: "安装用 `pip install -r requirements.txt`。Python 3.12 起支持。"
  },
  {
    before: "公式是 $$E = mc^2$$，推导见附录 A。",
    after: "推导见附录 A。公式是 $$E = mc^2$$。"
  },
  {
    before: "他说「先回滚」，时间是 2026 年 3 月 5 日 14:30。",
    after: "时间是 2026 年 3 月 5 日 14:30。他说「先回滚」。"
  },
  {
    before: "北京协和医院的方案随访 12 周，复发率 3.2%。",
    after: "北京协和医院的方案随访 12 周，复发率 3.2%。"
  },
  {
    before: "阿司匹林肠溶片 100mg 每晚一次，华法林 2.5mg 隔日。",
    after: "阿司匹林肠溶片 100mg 每晚一次，华法林 2.5mg 隔日。"
  },
  {
    before: "端口 8080 和 443 都要开，超时 30s，重试 3 次。",
    after: "端口 8080 和 443 都要开。超时 30s，重试 3 次。"
  },
  {
    before: "对照组 45 人、试验组 47 人，P=0.03。",
    after: "对照组 45 人、试验组 47 人，P=0.03。"
  },
  {
    before: "《中国高血压防治指南 2024》推荐目标值 130/80mmHg 以下。",
    after: "《中国高血压防治指南 2024》推荐目标值 130/80mmHg 以下。"
  }
];
var factPass = 0;
var factNumDrift = 0;
for (var f = 0; f < factFixtures.length; f++) {
  var v = Verify.verify(factFixtures[f].before, factFixtures[f].after);
  if (v.ok) factPass++;
  var bNums = (factFixtures[f].before.match(/\d+(?:\.\d+)?/g) || []).sort().join(",");
  var aNums = (factFixtures[f].after.match(/\d+(?:\.\d+)?/g) || []).sort().join(",");
  if (bNums !== aNums) factNumDrift++;
}
record(
  "3 事实：10 组事实文本 verify 100% 通过且数字改动 0 处",
  factPass === 10 && factNumDrift === 0,
  "通过 " + factPass + "/10，数字漂移 " + factNumDrift + " 处"
);
// 篡改必拦
var tamperCaught = 0;
var tampers = [
  ["有效率 82%。", "有效率 85%。"],
  ["随访 12 周。", "随访 20 周。"],
  ["用 `pip install x` 装。", "用 `npm install x` 装。"],
  ["他说「先回滚」。", "他说「先升级」。"],
  ["北京协和医院的方案。", "某医院的方案。"]
];
for (var t = 0; t < tampers.length; t++) {
  if (!Verify.verify(tampers[t][0], tampers[t][1]).ok) tamperCaught++;
}
record("3b 事实：5 组篡改全部被拦", tamperCaught === 5, "拦下 " + tamperCaught + "/5");

// ---------- 4 强度（改写全链回退） ----------
var strengthCases = [
  { name: "可能→会", before: "这可能导致延迟。", fn: function (p) { return p.replace("可能", "会"); } },
  { name: "相关→导致", before: "熬夜与脱发相关。", fn: function (p) { return p.replace("相关", "导致"); } },
  { name: "主次拉平", before: "缓存是关键，网络也有影响。", fn: function (p) { return p.replace("缓存是关键，网络也有影响", "先看缓存，再看网络"); } },
  { name: "部分缓解→有效", before: "用药后部分缓解。", fn: function (p) { return p.replace("部分缓解", "有效"); } },
  { name: "删程度词", before: "多数患者在 3 天内好转。", fn: function (p) { return p.replace("多数", ""); } }
];
var strengthFailCount = 0;
var strengthPromises = [];
for (var sc = 0; sc < strengthCases.length; sc++) {
  (function (c) {
    var sb = Scan.scan(c.before, "qa", "unknown", rules);
    var p = Rewrite.rewrite(c.before, sb, {
      register: "qa",
      model: "unknown",
      force: true,
      mockRewriter: mockFromProtected(function (protectedText) {
        return c.fn(protectedText); // 占位符原样保留，只做违规强度篡改
      })
    }).then(function (res) {
      if (!res.ok && res.text === c.before) strengthFailCount++;
    });
    strengthPromises.push(p);
  })(strengthCases[sc]);
}

// ---------- 5 安全 ----------
var safetyBefore = "发烧时别做的事：\n- ❌ 捂汗退烧\n- ❌ 掐人中\n**危险信号：呼吸困难、意识模糊**\n有疑问及时就医。";
var safetyGood = "发烧时别做的事：\n- 别捂汗退烧\n- 别掐人中\n**危险信号：呼吸困难、意识模糊**\n有疑问及时就医。";
var safetyBad = "发烧时别做的事：\n- 别捂汗退烧\n- 别掐人中\n**危险信号：呼吸困难、意识模糊**";
var vGood = Verify.verify(safetyBefore, safetyGood);
var vBad = Verify.verify(safetyBefore, safetyBad);
record(
  "5 安全：❌→文字否定 + 兜底/危险加粗保留",
  vGood.ok && safetyGood.indexOf("别捂汗") >= 0 && safetyGood.indexOf("有疑问及时就医") >= 0 && safetyGood.indexOf("**危险信号") >= 0,
  vGood.ok ? "good 改写通过校验" : "good 改写被误拦：" + JSON.stringify(vGood.violations.map(function (x) { return x.message; }))
);
record("5b 安全：删兜底提示必须拦下", !vBad.ok, vBad.ok ? "未拦下" : "已拦下（" + vBad.violations[0].message + "）");

// ---------- 6 闭环 ----------
var loopBefore = "先看日志——一般能定位。再看配置——多半是端口。";
var loopBad = "先看日志，说白了一般能定位。再看配置，说白了多半是端口。";
var loopGood = "先看日志，一般能定位。再看配置，多半是端口。";
var loopPromises = [];
var badCaught = false;
var goodPassed = false;
(function () {
  var sb = Scan.scan(loopBefore, "qa", "unknown", rules);
  loopPromises.push(
    Rewrite.rewrite(loopBefore, sb, {
      register: "qa",
      model: "unknown",
      mockRewriter: mockFromProtected(function () {
        return loopBad;
      })
    }).then(function (res) {
      badCaught = !res.ok && res.text === loopBefore && String(res.fallbackReason).indexOf("复扫") >= 0;
    })
  );
  loopPromises.push(
    Rewrite.rewrite(loopBefore, sb, {
      register: "qa",
      model: "unknown",
      mockRewriter: mockFromProtected(function () {
        return loopGood;
      })
    }).then(function (res) {
      goodPassed = res.ok && res.text === loopGood;
    })
  );
})();

// ---------- 7 时效 ----------
var oldRules = JSON.parse(JSON.stringify(rules));
for (var r7 = 0; r7 < oldRules.rules.length; r7++) {
  if (oldRules.rules[r7].id === "A4") oldRules.rules[r7].asOf = "2025-04-01";
}
var resStale = Scan.scan(loopBefore, "qa", "unknown", oldRules);
var a4stale = resStale.stats.filter(function (x) {
  return x.id === "A4";
})[0];
record(
  "7 时效：as_of 12 个月前自动降级观察项",
  !!a4stale && a4stale.level === "watch" && resStale.meta.staleDowngraded.indexOf("A4") >= 0,
  a4stale ? "A4 level=" + a4stale.level + "，已记录降级" : "A4 未产出"
);

// ---------- 8 降级 ----------
var degradePromises = [];
var noKeyOk = false;
var badUrlOk = false;
(function () {
  var text = "综上所述，这个方案是可行的。";
  var sb = Scan.scan(text, "qa", "unknown", rules);
  degradePromises.push(
    Rewrite.rewrite(text, sb, { register: "qa", model: "unknown", apiKey: "" }).then(function (res) {
      noKeyOk = !res.ok && res.text === text;
    })
  );
  degradePromises.push(
    Rewrite.rewrite(text, sb, {
      register: "qa",
      model: "unknown",
      apiKey: "sk-x",
      baseUrl: "https://127.0.0.1:1",
      timeoutMs: 1500,
      fetchImpl: function () {
        return Promise.reject(new Error("connect ECONNREFUSED"));
      }
    }).then(function (res) {
      badUrlOk = !res.ok && res.text === text;
    })
  );
})();

// ---------- 等待异步并汇总 ----------
Promise.all(strengthPromises.concat(loopPromises, degradePromises)).then(function () {
  record(
    "4 强度：5 组强度篡改全部 fail 并回退原文",
    strengthFailCount === 5,
    "拦下回退 " + strengthFailCount + "/5"
  );
  record("6 闭环：坏改写（破折号→说白了）被拦下回退", badCaught, badCaught ? "复扫拦截生效" : "未拦截");
  record("6b 闭环：好改写通过", goodPassed, goodPassed ? "通过" : "未通过");
  record("8 降级：无 API Key / 错误地址返回原文不崩", noKeyOk && badUrlOk, "无Key=" + noKeyOk + "，错误地址=" + badUrlOk);

  // 规则级误报率（rulecheck）
  var rc = Rulecheck.rulecheck(humanDocs, aiDocs, { rules: rules });
  reportLines.push("");
  reportLines.push("## 规则级误报（rulecheck，真人语料 " + rc.summary.humanDocs + " 段）");
  reportLines.push("");
  reportLines.push("| 规则 | 误报文档 | 误报率 | AI 检出 | 建议 |");
  reportLines.push("|---|---|---|---|---|");
  for (var q = 0; q < rc.rules.length; q++) {
    var row = rc.rules[q];
    if (row.humanFlagged === 0 && row.aiFlagged === 0) continue;
    reportLines.push(
      "| " + row.id + (row.variantId ? "/" + row.variantId : "") + " | " + row.humanFlagged + "/" + row.humanDocs +
      " | " + (row.fpRate * 100).toFixed(1) + "% | " + row.aiFlagged + "/" + row.aiDocs + " | " + row.suggestion + " |"
    );
  }
  reportLines.push("");
  reportLines.push("文档级：真人偏高 " + humanFlagged.length + "/40（" + (fpRate * 100).toFixed(1) + "%）；AI 检出 " + aiFlagged.length + "/20（" + (detRate * 100).toFixed(0) + "%）");

  var allPass = results.every(function (x) {
    return x.pass;
  });
  console.log("");
  console.log("验收测试：" + (allPass ? "全部通过" : "有失败") + "（" + results.filter(function (x) { return x.pass; }).length + "/" + results.length + "）");
  fs.writeFileSync(path.join(__dirname, "acceptance-report.md"), reportLines.join("\n") + "\n", "utf8");
  console.log("报告已写入 tests/acceptance-report.md");
  if (!allPass) process.exitCode = 1;
});
