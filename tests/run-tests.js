/**
 * run-tests.js —— 单元测试（零依赖，node tests/run-tests.js）
 * 覆盖：每条规则 1 个正例 + 2 个反例（由 rules.json 的 examples 驱动）、
 * 引擎工具、scan 判定、verify 五层、rescan 闭环、rewrite 降级链。
 */
"use strict";

var path = require("path");
var E = require(path.join(__dirname, "..", "src", "core", "engine.js"));
var Scan = require(path.join(__dirname, "..", "src", "core", "scan.js"));
var Verify = require(path.join(__dirname, "..", "src", "core", "verify.js"));
var Rescan = require(path.join(__dirname, "..", "src", "core", "rescan.js"));
var Rewrite = require(path.join(__dirname, "..", "src", "core", "rewrite.js"));
var Prompts = require(path.join(__dirname, "..", "src", "core", "prompts.js"));
var rules = require(path.join(__dirname, "..", "src", "core", "rules.json"));

// ---------- 迷你测试框架（支持返回 Promise 的异步用例） ----------
var passed = 0;
var failed = 0;
var failures = [];
var asyncTests = [];

function test(name, fn) {
  var result;
  try {
    result = fn();
  } catch (err) {
    failed++;
    failures.push({ name: name, err: err.message });
    return;
  }
  if (result && typeof result.then === "function") {
    asyncTests.push({ name: name, promise: result });
  } else {
    passed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "断言失败");
}

function assertEqual(actual, expected, msg) {
  if (actual !== expected) {
    throw new Error((msg || "不相等") + "：实际 " + JSON.stringify(actual) + " ≠ 期望 " + JSON.stringify(expected));
  }
}

// ---------- 一、规则示例测试（每条 1 正例 + 2 反例） ----------

function familyHits(result, ruleId) {
  var n = 0;
  for (var i = 0; i < result.stats.length; i++) {
    if (result.stats[i].id === ruleId) n += result.stats[i].hits;
  }
  return n;
}

function familyFlagged(result, ruleId) {
  for (var i = 0; i < result.stats.length; i++) {
    var st = result.stats[i];
    if (st.id === ruleId && (st.level === "elevated" || st.level === "high")) return true;
  }
  return false;
}

test("规则库完整性：54 条且每条必含字段", function () {
  assertEqual(rules.rules.length, 54, "规则总数应为 54");
  for (var i = 0; i < rules.rules.length; i++) {
    var r = rules.rules[i];
    ["id", "name", "group", "evidenceLevel", "evidence", "type", "registers", "models", "asOf", "boundary", "advice", "examples"].forEach(function (f) {
      assert(r[f] !== undefined, r.id + " 缺字段 " + f);
    });
    assert(r.examples.positive && r.examples.positive.length >= 1, r.id + " 缺正例");
    assert(r.examples.negative && r.examples.negative.length >= 2, r.id + " 缺 2 条反例");
    if (r.type !== "text") {
      assert(r.judgment !== undefined, r.id + " 缺 judgment");
    }
  }
});

var exampleRules = rules.rules.filter(function (r) {
  return r.type !== "text";
});

exampleRules.forEach(function (rule) {
  var register = rule.registers[0] || "qa";
  test("规则示例·" + rule.id + " " + rule.name + "：正例命中", function () {
    for (var i = 0; i < rule.examples.positive.length; i++) {
      var res = Scan.scan(rule.examples.positive[i], register, "unknown", rules);
      assert(familyHits(res, rule.id) >= 1, rule.id + " 正例未命中：" + rule.examples.positive[i].slice(0, 40));
    }
  });
  test("规则示例·" + rule.id + " " + rule.name + "：反例不判", function () {
    for (var i = 0; i < rule.examples.negative.length; i++) {
      var res = Scan.scan(rule.examples.negative[i], register, "unknown", rules);
      if (rule.judgment === "double") {
        assert(!familyFlagged(res, rule.id), rule.id + " 反例被误判偏高：" + rule.examples.negative[i].slice(0, 40));
      } else {
        assertEqual(familyHits(res, rule.id), 0, rule.id + " 反例误命中：" + rule.examples.negative[i].slice(0, 40));
      }
    }
  });
});

// C 组：禁止清单不写检测器
test("C 组禁止清单：不产生任何检测项", function () {
  var cRules = rules.rules.filter(function (r) {
    return r.group === "C";
  });
  assertEqual(cRules.length, 10, "C 组应 10 条");
  for (var i = 0; i < cRules.length; i++) {
    assertEqual(cRules[i].type, "text", cRules[i].id + " 应为 text");
    assertEqual(cRules[i].judgment, "none", cRules[i].id + " 应为 none");
  }
  var res = Scan.scan("设问留着。比喻留着。被动句留着。四字格留着。", "qa", "unknown", rules);
  for (var j = 0; j < res.stats.length; j++) {
    assert(res.stats[j].group !== "C", "C 组不应出现在 stats");
  }
});

// ---------- 二、引擎测试 ----------

test("engine：代码块/行内代码/URL 被遮罩", function () {
  var text = "看这段 `let x = 1` 和 ```\ncode\n``` 以及 https://example.com/a 不是摆设。";
  var masked = E.maskZones(text, "sentence");
  assert(masked.indexOf("let x = 1") < 0, "行内代码未遮罩");
  assert(masked.indexOf("https://example.com") < 0, "URL 未遮罩");
  assert(masked.indexOf("不是摆设") >= 0, "正文被误遮罩");
  assertEqual(masked.length, text.length, "遮罩必须等长");
});

test("engine：分句（中英混排）", function () {
  var zh = E.splitSentences("先看日志。再看配置！");
  assertEqual(zh.length, 2, "中文两句");
  var en = E.splitSentences("Run npm install. Then check e.g. the config.");
  assertEqual(en.length, 2, "英文两句（缩写 e.g. 不切分）");
});

test("engine：密度分母", function () {
  assertEqual(E.countHanzi("中文测试"), 4, "汉字计数");
  assert(E.countWords("hello world 2024") === 3, "英文词计数");
});

test("engine：事实抽取", function () {
  var nums = E.extractNumbers("剂量 500mg，每天 2 次，有效率 82%");
  assert(nums.indexOf("500mg") >= 0 && nums.indexOf("82%") >= 0, "数字+单位抽取：" + nums.join(","));
  assertEqual(E.extractUrls("见 https://a.com/x 吧").length, 1, "URL 抽取");
  assertEqual(E.extractCode("用 `ls -l` 看").length, 1, "行内代码抽取");
});

test("engine：模糊重叠率", function () {
  assert(E.overlapRatio("有疑问及时就医", "有疑问及时就医！") === 1, "完全一致");
  assert(E.overlapRatio("完全不同", "另一句话") < 0.5, "不同句子");
});

// ---------- 三、scan 判定测试 ----------

test("scan：密度判定 高/偏高/正常 分层", function () {
  // 破折号：AI 基线 2.38/千字；人类 0.80
  var heavy = "先看日志——一般能定位。再看配置——多半是端口。还有权限——也可能挡。";
  var res = Scan.scan(heavy, "qa", "unknown", rules);
  var a4 = res.stats.filter(function (x) {
    return x.id === "A4";
  })[0];
  assert(a4 && a4.hits === 3, "A4 应命中 3 处");
  assertEqual(a4.level, "high", "密度 ≥ AI 基线应判高");
  var light = "先看日志，一般能定位问题。";
  var res2 = Scan.scan(light, "qa", "unknown", rules);
  var a4b = res2.stats.filter(function (x) {
    return x.id === "A4";
  })[0];
  assertEqual(a4b.level, "normal", "无命中应正常");
});

test("scan：观察项进 watchlist 不进重点", function () {
  var res = Scan.scan("效果显著提升了，测试通过率从 82% 提到了 95%。", "qa", "unknown", rules);
  var a8 = res.stats.filter(function (x) {
    return x.id === "A8";
  })[0];
  assert(a8 && a8.hits === 1, "A8 应命中");
  assertEqual(a8.level, "watch", "A8 已撤销只观察");
  var inWatch = res.watchlist.some(function (w) {
    return w.id === "A8";
  });
  assert(inWatch, "A8 应进观察项");
});

test("scan：A10 翻译腔同段堆叠才算偏高", function () {
  var stacked = "对于用户来说，当配置生效时，响应会变快，日志也会变少，端口也不用改。";
  var res = Scan.scan(stacked, "qa", "unknown", rules);
  var a10 = res.stats.filter(function (x) {
    return x.id === "A10";
  });
  var anyElevated = a10.some(function (x) {
    return x.level === "elevated";
  });
  assert(anyElevated, "同段 ≥2 处应偏高：" + JSON.stringify(a10.map(function (x) { return x.level; })));
  var single = "对于用户来说，响应会变快。";
  var res2 = Scan.scan(single, "qa", "unknown", rules);
  var a10b = res2.stats.filter(function (x) {
    return x.id === "A10";
  });
  a10b.forEach(function (x) {
    assert(x.level !== "elevated", "单处不应偏高");
  });
});

test("scan：A5 序数小标题只在问答等文体生效", function () {
  var text = "一、安装步骤\n二、配置说明\n三、常见问题";
  var resQa = Scan.scan(text, "qa", "unknown", rules);
  var a5qa = resQa.stats.filter(function (x) {
    return x.id === "A5";
  })[0];
  assert(a5qa && a5qa.hits === 3, "问答档应命中");
  var resFormal = Scan.scan(text, "formal", "unknown", rules);
  var a5formal = resFormal.stats.filter(function (x) {
    return x.id === "A5";
  })[0];
  assert(!a5formal, "公文章节编号不应命中");
});

test("scan：模型侧重与无基线提示", function () {
  var res = Scan.scan("测试文本，正常行文。", "qa", "kimi", rules);
  assert(res.meta.modelHasBaseline === false, "Kimi 应标无基线");
  assert(res.meta.modelNote.indexOf("该模型无基线数据") === 0, "报告首行提示");
  var res2 = Scan.scan("测试文本，正常行文。", "qa", "deepseek", rules);
  assert(res2.meta.focusRules.indexOf("A4") >= 0, "DeepSeek 重点查 A4");
});

test("scan：时效过期自动降级观察项", function () {
  var oldRules = JSON.parse(JSON.stringify(rules));
  for (var i = 0; i < oldRules.rules.length; i++) {
    if (oldRules.rules[i].id === "A1") {
      oldRules.rules[i].asOf = "2025-01-01"; // 12 个月前
    }
  }
  var text = "这不是效率问题，而是流程设计的问题。这不是成本问题，而是排期问题。";
  var res = Scan.scan(text, "qa", "unknown", oldRules);
  var a1 = res.stats.filter(function (x) {
    return x.id === "A1";
  })[0];
  assert(a1.hits === 2, "应仍命中 2 处");
  assertEqual(a1.level, "watch", "过期规则应降级观察项");
  assert(res.meta.staleDowngraded.indexOf("A1") >= 0, "应记录降级");
});

// ---------- 四、verify 五层测试 ----------

test("verify：完全一致通过", function () {
  var t = "剂量 500mg，每天 2 次。有效率 82%。有问题及时就医。";
  var v = Verify.verify(t, t);
  assert(v.ok, "相同文本应通过：" + JSON.stringify(v.violations));
});

test("verify 事实层：数字改动必须失败", function () {
  var v = Verify.verify("有效率 82%。", "有效率 85%。");
  assert(!v.ok, "改数字必须 fail");
  assert(v.violations[0].layer === "fact", "应报事实层");
});

test("verify 事实层：专名缺失/新增必须失败", function () {
  var v1 = Verify.verify("在北京协和医院做的检查。", "在医院做的检查。");
  assert(!v1.ok, "专名缺失必须 fail");
  var v2 = Verify.verify("在医院做的检查。", "在北京协和医院做的检查。");
  assert(!v2.ok, "专名新增（编造）必须 fail");
});

test("verify 事实层：URL/代码/引文保真", function () {
  var v = Verify.verify("见 https://a.com/x，用 `ls -l` 看他说的「先回滚」。", "见 https://b.com/y，用 `ls -l` 看他说的「先回滚」。");
  assert(!v.ok, "URL 改动必须 fail");
});

test("verify 强度层：可能→会 必须失败", function () {
  var v = Verify.verify("这可能导致延迟。", "这会导致延迟。");
  assert(!v.ok, "加强必须 fail");
  var v2 = Verify.verify("这会导致延迟。", "这可能导致延迟。");
  assert(!v2.ok, "减弱必须 fail");
});

test("verify 强度层：相关→导致 必须失败", function () {
  var v = Verify.verify("熬夜与脱发相关。", "熬夜导致脱发。");
  assert(!v.ok, "因果升级必须 fail");
});

test("verify 强度层：整句删除无事实句豁免", function () {
  var v = Verify.verify("结果是好的。可能还有别的原因。", "结果是好的。");
  assert(v.ok, "删除无事实的空泛句应通过：" + JSON.stringify(v.violations));
});

test("verify 强度层：对冲堆叠消解豁免（B10）", function () {
  var v = Verify.verify("这也许可能会影响性能。", "这可能会影响性能。");
  assert(v.ok, "堆叠留一个应通过：" + JSON.stringify(v.violations));
});

test("verify 主次层：X 是关键 Y 也… 被拉平必须失败", function () {
  var v = Verify.verify("缓存是关键，网络也有影响。", "先看缓存，再看网络。");
  assert(!v.ok, "主次拉平必须 fail");
  var v2 = Verify.verify("缓存是关键，网络也有影响。", "缓存还是关键，网络也有影响。");
  assert(v2.ok, "主次保留应通过");
});

test("verify 安全层：❌ 删掉必须换文字否定", function () {
  var v = Verify.verify("❌ 掐人中。", "掐人中。");
  assert(!v.ok, "直接删标记必须 fail");
  var v2 = Verify.verify("❌ 掐人中。", "别掐人中。");
  assert(v2.ok, "换成文字否定应通过：" + JSON.stringify(v2.violations));
});

test("verify 安全层：兜底提示与危险加粗保留", function () {
  var v = Verify.verify("高烧不退要就医。**危险信号：呼吸困难**。有疑问及时就医。", "高烧不退要就医。呼吸困难。没别的了。");
  assert(!v.ok, "删兜底/删加粗必须 fail");
  var v2 = Verify.verify("**危险信号：呼吸困难**。有疑问及时就医。", "**危险信号：呼吸困难**。有疑问及时就医。");
  assert(v2.ok, "原样保留应通过");
});

test("verify 安全层：禁止新增氛围细节", function () {
  var v = Verify.verify("他回复了邮件。", "凌晨三点，他愣了一下，回复了邮件。");
  assert(!v.ok, "编造氛围细节必须 fail");
});

test("verify 结构层：标题/代码块/表格/列表", function () {
  var before = "# 标题\n\n- a\n- b\n- c\n\n```\ncode\n```";
  var afterAddHeading = "# 标题\n\n## 新标题\n\n- a\n- b\n- c\n\n```\ncode\n```";
  assert(!Verify.verify(before, afterAddHeading).ok, "加标题必须 fail");
  var afterMerge3 = "# 标题\n\na、b、c 三项。\n\n```\ncode\n```";
  assert(Verify.verify(before, afterMerge3).ok, "≤4 项列表并句应通过：" + JSON.stringify(Verify.verify(before, afterMerge3).violations));
  var afterDrop5 = before + "\n- d\n- e\n";
  var v = Verify.verify(afterDrop5, "# 标题\n\n```\ncode\n```");
  assert(!v.ok, "删 5 项列表必须 fail");
});

// ---------- 五、rescan 闭环测试 ----------

test("rescan：密度下降且无新偏高 → 通过", function () {
  var before = "综上所述，这个方案是可行的。先看日志——一般能定位。再看配置——多半是端口。";
  var after = "这个方案可行。先看日志，一般能定位。再看配置，多半是端口。";
  var sb = Scan.scan(before, "qa", "unknown", rules);
  var rc = Rescan.rescan(before, after, sb, { register: "qa", model: "unknown", rules: rules });
  assert(rc.ok, "正常改写应通过：" + rc.reason);
});

test("rescan：把破折号换成「说白了」必须被拦下", function () {
  var before = "先看日志——一般能定位。再看配置——多半是端口。";
  var after = "先看日志，说白了一般能定位。再看配置，说白了多半是端口。";
  var sb = Scan.scan(before, "qa", "unknown", rules);
  var rc = Rescan.rescan(before, after, sb, { register: "qa", model: "unknown", rules: rules });
  assert(!rc.ok, "换味必须 fail");
  assert(rc.newElevated.length >= 1, "应报新增偏高项");
});

test("rescan：被处理项密度没降 → 拦下", function () {
  var before = "这不是效率问题，而是流程问题。这不是成本问题，而是排期问题。";
  var after = "这不是成本问题，而是排期问题。这不是效率问题，而是流程问题。";
  var sb = Scan.scan(before, "qa", "unknown", rules);
  var rc = Rescan.rescan(before, after, sb, { register: "qa", model: "unknown", rules: rules });
  assert(!rc.ok, "密度未降必须 fail");
});

// ---------- 六、rewrite 降级链测试（mock 改写器） ----------

function mockOutput(finalText, extra) {
  return "［终稿］\n" + finalText + "\n---\n改动说明\n- 测试改动\n" + (extra || "");
}

test("rewrite：占位符保护与回填", function () {
  var text = "有效率 82%，见 https://a.com/x。";
  var p = Rewrite.protectFacts(text);
  assert(p.text.indexOf("82%") < 0, "数字应被保护");
  assert(p.text.indexOf("⟦T") >= 0, "应有占位符");
  var r = Rewrite.restoreFacts(p.text, p.tokens);
  assert(r.ok && r.text === text, "回填应还原原文");
  var bad = Rewrite.restoreFacts(p.text.replace("⟦T1⟧", "99%"), p.tokens);
  assert(!bad.ok, "占位符丢失应失败");
});

test("rewrite：正常改写走通全链", function () {
  var text = "综上所述，这个方案是可行的。";
  var sb = Scan.scan(text, "qa", "unknown", rules);
  return Rewrite.rewrite(text, sb, {
    register: "qa",
    model: "unknown",
    mockRewriter: function (protectedText) {
      return mockOutput("这个方案可行。");
    }
  }).then(function (res) {
    assert(res.ok, "应改写成功：" + res.fallbackReason);
    assertEqual(res.text, "这个方案可行。");
  });
});

test("rewrite：改数字必须回退原文", function (done) {
  var text = "有效率 82%。";
  var sb = Scan.scan(text, "qa", "unknown", rules);
  return Rewrite.rewrite(text, sb, {
    register: "qa",
    model: "unknown",
    force: true,
    mockRewriter: function (protectedText) {
      // 占位符原样回显但把数字改掉（模拟绕过占位符的坏改写）
      return mockOutput("有效率 95%。");
    }
  }).then(function (res) {
    assert(!res.ok, "改数字必须 fail");
    assertEqual(res.text, text, "必须回退原文");
  });
});

test("rewrite：解析失败必须回退", function () {
  var text = "综上所述，这个方案是可行的。";
  var sb = Scan.scan(text, "qa", "unknown", rules);
  return Rewrite.rewrite(text, sb, {
    register: "qa",
    model: "unknown",
    mockRewriter: function () {
      return "改好了，以下是结果：这个方案可行。";
    }
  }).then(function (res) {
    assert(!res.ok, "解析失败必须 fail");
    assertEqual(res.text, text, "必须回退原文");
  });
});

test("rewrite：无 API Key 降级不崩", function () {
  var text = "综上所述，这个方案是可行的。";
  var sb = Scan.scan(text, "qa", "unknown", rules);
  return Rewrite.rewrite(text, sb, { register: "qa", model: "unknown", apiKey: "" }).then(function (res) {
    assert(!res.ok, "无 Key 必须降级");
    assertEqual(res.text, text, "返回原文");
    assert(res.fallbackReason.indexOf("API Key") >= 0, "说明原因");
  });
});

test("rewrite：接口失败降级不崩", function () {
  var text = "综上所述，这个方案是可行的。";
  var sb = Scan.scan(text, "qa", "unknown", rules);
  return Rewrite.rewrite(text, sb, {
    register: "qa",
    model: "unknown",
    apiKey: "sk-test",
    baseUrl: "https://127.0.0.1:1",
    timeoutMs: 2000,
    fetchImpl: function () {
      return Promise.reject(new Error("connect ECONNREFUSED"));
    }
  }).then(function (res) {
    assert(!res.ok, "接口失败必须降级");
    assertEqual(res.text, text, "返回原文");
    assert(res.fallbackReason.indexOf("模型调用失败") >= 0, "说明原因");
  });
});

test("rewrite：输出解析（含各小节）", function () {
  var raw = "［终稿］\n新的正文。\n---\n改动说明\n- 删除 1 处空总结\n【观察项】A4 破折号 1 处\n【需作者确认】无\n【待补】真实数字";
  var p = Rewrite.parseRewriteOutput(raw);
  assert(p.ok, "应解析成功");
  assertEqual(p.text, "新的正文。");
  assertEqual(p.report.changes[0], "删除 1 处空总结");
  assertEqual(p.report.todo[0], "真实数字");
});

test("prompt A/B 逐字内嵌", function () {
  assert(Prompts.PROMPT_A.indexOf("你是正文写作助手") === 0, "提示词 A 开头");
  assert(Prompts.PROMPT_B.indexOf("角色：文本改写器") === 0, "提示词 B 开头");
  assert(Prompts.PROMPT_B.indexOf("信息守恒") > 0 && Prompts.PROMPT_B.indexOf("禁止清单") > 0, "硬约束齐全");
});

// ---------- 汇总（先等异步用例） ----------
(function runAsync() {
  var chain = Promise.resolve();
  asyncTests.forEach(function (t) {
    chain = chain.then(function () {
      return t.promise.then(
        function () {
          passed++;
        },
        function (err) {
          failed++;
          failures.push({ name: t.name, err: err && err.message ? err.message : String(err) });
        }
      );
    });
  });
  chain.then(function () {
    console.log("");
    console.log("单元测试：通过 " + passed + "，失败 " + failed + "，合计 " + (passed + failed));
    if (failed) {
      console.log("");
      console.log("失败明细：");
      for (var i = 0; i < failures.length; i++) {
        console.log("  ✗ " + failures[i].name + "\n    " + failures[i].err);
      }
      process.exitCode = 1;
    }
  });
})();
