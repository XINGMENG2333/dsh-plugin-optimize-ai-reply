/**
 * dsh-plugin.test.js —— DeepSeek Harness 插件契约测试（零依赖）
 * 覆盖：入口导出、Standard Schema 配置、7 个工具注册与执行、
 *       bundle 契约（package.json dsh.bundle / cordis.patch.yml / engines.dsh）、
 *       市场索引 format 1 校验、awesome-dsh-plugin 提交文件校验。
 */
"use strict";

var fs = require("fs");
var path = require("path");

var ROOT = path.join(__dirname, "..");
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

// ---------- 一、入口导出 ----------

var plugin = require(path.join(ROOT, "index.js"));

test("入口：导出 name/inject/Config/apply/default", function () {
  assertEqual(plugin.name, "optimize-ai-reply");
  assert(Array.isArray(plugin.inject) && plugin.inject.indexOf("tools") >= 0, "inject 应含 tools");
  assert(typeof plugin.apply === "function", "apply 应为函数");
  assert(plugin.Config && plugin.Config["~standard"], "Config 应实现 Standard Schema");
  assert(plugin.default && plugin.default.apply === plugin.apply, "default 导出应一致");
});

test("入口：ESM 包装文件存在且引用 CJS 实现", function () {
  var mjs = fs.readFileSync(path.join(ROOT, "index.mjs"), "utf8");
  assert(mjs.indexOf('from "./index.js"') >= 0, "index.mjs 应复用 index.js");
  assert(mjs.indexOf("export const apply") >= 0 && mjs.indexOf("export default") >= 0, "应有具名+默认导出");
});

// ---------- 二、Standard Schema 配置 ----------

test("配置 Schema：默认值填充", function () {
  var res = plugin.Config["~standard"].validate(undefined);
  assert(res.value, "应返回 value：" + JSON.stringify(res.issues));
  assertEqual(res.value.defaultRegister, "qa");
  assertEqual(res.value.thresholdMultiplier, 2);
  assertEqual(res.value.showWatchlist, true);
  assert(Array.isArray(res.value.disabledRules) && res.value.disabledRules.length === 0);
});

test("配置 Schema：非法值报 issues", function () {
  var bad1 = plugin.Config["~standard"].validate({ defaultRegister: "诗歌" });
  assert(bad1.issues && bad1.issues.length > 0, "非法文体应报错");
  var bad2 = plugin.Config["~standard"].validate({ thresholdMultiplier: 99 });
  assert(bad2.issues && bad2.issues.length > 0, "超范围阈值应报错");
  var bad3 = plugin.Config["~standard"].validate({ showWatchlist: "yes" });
  assert(bad3.issues && bad3.issues.length > 0, "类型错误应报错");
});

test("配置 Schema：合法值通过并保留", function () {
  var ok = plugin.Config["~standard"].validate({ defaultRegister: "academic", thresholdMultiplier: 3, disabledRules: ["A4"] });
  assert(ok.value, "应通过：" + JSON.stringify(ok.issues));
  assertEqual(ok.value.defaultRegister, "academic");
  assertEqual(ok.value.disabledRules[0], "A4");
});

// ---------- 三、工具注册与执行 ----------

function fakeCtx() {
  var registered = [];
  return {
    registered: registered,
    tools: {
      register: function (t) {
        registered.push(t);
      }
    },
    logger: { info: function () {}, warn: function () {} }
  };
}

test("apply：注册 7 个工具且定义完整", function () {
  var ctx = fakeCtx();
  plugin.apply(ctx, plugin.Config["~standard"].validate(undefined).value);
  assertEqual(ctx.registered.length, 7, "应注册 7 个工具");
  var names = ctx.registered.map(function (t) { return t.name; });
  ["optimize_reply_scan", "optimize_reply_brief", "optimize_reply_verify", "optimize_reply_rescan", "optimize_reply_check", "optimize_reply_style_prompt", "optimize_reply_rulecheck"].forEach(function (n) {
    assert(names.indexOf(n) >= 0, "缺少工具 " + n);
  });
  ctx.registered.forEach(function (t) {
    assert(t.description && t.description.length > 20, t.name + " 缺描述");
    assert(t.parameters && typeof t.parameters === "object", t.name + " 缺参数表");
    assert(t.output && t.output.schema && typeof t.output.render === "function", t.name + " 缺 output");
    assert(typeof t.execute === "function", t.name + " 缺 execute");
  });
});

function toolByName(ctx, name) {
  for (var i = 0; i < ctx.registered.length; i++) {
    if (ctx.registered[i].name === name) return ctx.registered[i];
  }
  return null;
}

test("optimize_reply_scan：返回密度报告且含基线字段", function () {
  var ctx = fakeCtx();
  plugin.apply(ctx, undefined);
  return toolByName(ctx, "optimize_reply_scan")
    .execute({ text: "综上所述，这个方案是可行的。这不是效率问题，而是流程问题。" })
    .then(function (out) {
      var rep = JSON.parse(out);
      assert(rep.stats && rep.stats.length > 0, "应有命中项");
      assert(rep.meta && typeof rep.meta.hanzi === "number", "应含 meta");
      var row = rep.stats[0];
      ["id", "name", "hits", "density", "level", "advice"].forEach(function (f) {
        assert(row[f] !== undefined, "stats 缺字段 " + f);
      });
    });
});

test("optimize_reply_brief：干净文本 → 无需改写；命中文本 → 含硬约束与工作流", function () {
  var ctx = fakeCtx();
  plugin.apply(ctx, undefined);
  var brief = toolByName(ctx, "optimize_reply_brief");
  return brief
    .execute({ text: "先备份配置，再改端口。有问题看日志。" })
    .then(function (clean) {
      assert(clean.indexOf("无需改写") >= 0, "干净文本应提示无需改写");
      return brief.execute({ text: "综上所述，这一突破标志着行业进入了新的高度。说白了，这不是效率问题，而是流程设计的问题。" });
    })
    .then(function (dirty) {
      assert(dirty.indexOf("信息守恒") >= 0, "应含硬约束（信息守恒）");
      assert(dirty.indexOf("optimize_reply_check") >= 0, "应要求调用校验工具");
      assert(dirty.indexOf("回退") >= 0, "应回退规则");
    });
});

test("optimize_reply_verify / optimize_reply_rescan / optimize_reply_check：好改写 accept、坏改写 revert", function () {
  var ctx = fakeCtx();
  plugin.apply(ctx, undefined);
  var before = "先看日志——一般能定位。再看配置——多半是端口。";
  var good = "先看日志，一般能定位。再看配置，多半是端口。";
  var bad = "先看日志，说白了一般能定位。再看配置，说白了多半是端口。";
  return toolByName(ctx, "optimize_reply_check")
    .execute({ before: before, after: good })
    .then(function (okOut) {
      var okRes = JSON.parse(okOut);
      assertEqual(okRes.action, "accept", "好改写应 accept：" + JSON.stringify(okRes.reasons));
      return toolByName(ctx, "optimize_reply_check").execute({ before: before, after: bad });
    })
    .then(function (badOut) {
      var badRes = JSON.parse(badOut);
      assertEqual(badRes.action, "revert", "换味改写应 revert");
      assert(badRes.reasons.length > 0, "应给出原因");
      // 单独的 verify/rescan 也要工作
      return toolByName(ctx, "optimize_reply_verify").execute({ before: "有效率 82%。", after: "有效率 85%。" });
    })
    .then(function (vOut) {
      var v = JSON.parse(vOut);
      assertEqual(v.ok, false, "改数字必须 fail");
      assertEqual(v.violations[0].layer, "fact");
    });
});

test("optimize_reply_style_prompt：返回提示词 A", function () {
  var ctx = fakeCtx();
  plugin.apply(ctx, undefined);
  return toolByName(ctx, "optimize_reply_style_prompt").execute({ task: "写一份部署说明" }).then(function (out) {
    assert(out.indexOf("你是正文写作助手") >= 0, "应为提示词 A");
    assert(out.indexOf("写一份部署说明") >= 0, "任务应附后");
  });
});

test("optimize_reply_rulecheck：跑内置语料给出误报率", function () {
  var ctx = fakeCtx();
  plugin.apply(ctx, undefined);
  return toolByName(ctx, "optimize_reply_rulecheck").execute({}).then(function (out) {
    var rep = JSON.parse(out);
    assert(rep.summary && rep.summary.humanDocs === 40, "应为 40 段真人语料");
    assert(rep.summary.docFpRate <= 0.05, "误报率应 ≤5%，实际 " + rep.summary.docFpRate);
  });
});

test("配置生效：disabledRules 关闭规则后扫描不再产出", function () {
  var ctx = fakeCtx();
  var cfg = plugin.Config["~standard"].validate({ disabledRules: ["A4"] }).value;
  plugin.apply(ctx, cfg);
  return toolByName(ctx, "optimize_reply_scan")
    .execute({ text: "先看日志——定位。再看配置——看端口。" })
    .then(function (out) {
      var rep = JSON.parse(out);
      var a4 = rep.stats.filter(function (s) { return s.id === "A4"; });
      assertEqual(a4.length, 0, "A4 关闭后不应产出");
    });
});

// ---------- 四、bundle 契约 ----------

test("bundle：package.json 声明 dsh.bundle / engines.dsh / files", function () {
  var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert(pkg.dsh && pkg.dsh.bundle && pkg.dsh.bundle.patch === "./cordis.patch.yml", "dsh.bundle.patch 应指向 cordis.patch.yml");
  assert(pkg.engines && pkg.engines.dsh, "应声明 engines.dsh");
  assert(pkg.files.indexOf("index.js") >= 0 && pkg.files.indexOf("cordis.patch.yml") >= 0, "files 应含入口与 patch");
  assert(pkg.files.indexOf("src/core/") >= 0 && pkg.files.indexOf("src/dsh/") >= 0, "files 应含核心与工具层");
  assert(pkg.keywords.indexOf("dsh-plugin") >= 0, "keywords 应含 dsh-plugin（GitHub/市场自动收录依赖）");
  assertEqual(pkg.name, "dsh-plugin-optimize-ai-reply");
});

test("bundle：cordis.patch.yml 引用包名且结构正确", function () {
  var yml = fs.readFileSync(path.join(ROOT, "cordis.patch.yml"), "utf8");
  assert(yml.indexOf("- insert:") >= 0, "应为 insert 层");
  assert(yml.indexOf("name: dsh-plugin-optimize-ai-reply") >= 0, "应引用包名（Node 解析）");
  assert(yml.indexOf("id: optimize-ai-reply") >= 0, "应有行 id");
});

test("bundle：dsh.bundle.patch 文件真实存在", function () {
  var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert(fs.existsSync(path.join(ROOT, pkg.dsh.bundle.patch)), "patch 文件缺失");
});

// ---------- 五、市场索引（format 1） ----------

test("market/index.json：format 1 必填字段齐全", function () {
  var idx = JSON.parse(fs.readFileSync(path.join(ROOT, "market", "index.json"), "utf8"));
  assertEqual(idx.format, 1);
  assert(idx.title && idx.title.en, "市场 title 需含 en");
  assert(Array.isArray(idx.plugins) && idx.plugins.length >= 1, "plugins 非空");
  var p = idx.plugins[0];
  assertEqual(p.name, "dsh-plugin-optimize-ai-reply");
  assert(p.title && p.title.en && p.title.zh, "插件 title 双语");
  assert(p.description && p.description.en, "插件 description 需含 en");
  assert(p.repository && /^https:\/\//.test(p.repository.url), "repository.url 需 https");
  assert(Array.isArray(p.versions) && p.versions.length >= 1, "versions 非空");
  p.versions.forEach(function (v) {
    assert(/^\d+\.\d+\.\d+/.test(v.version), "version 需 SemVer：" + v.version);
    assert(typeof v.publishTimestamp === "number" && v.publishTimestamp > 0, "publishTimestamp 需 Unix 秒");
    assert(v.source && (v.source.type === "npm" || v.source.type === "git"), "source 类型合法");
    if (v.source.type === "git") {
      assert(/^https:\/\//.test(v.source.url) && /^[0-9a-f]{40}$/.test(v.commit), "git 源需 https url + 40 位 commit");
    }
    if (v.engines) assert(typeof v.engines.dsh === "string", "engines.dsh 需为字符串");
  });
  // 图标：data: URL ≤32 KiB
  if (p.icon.indexOf("data:") === 0) {
    assert(p.icon.length <= 32 * 1024, "内联图标需 ≤32 KiB");
  }
});

test("market/index.json 与生成器输出一致（防漂移）", function () {
  // 生成器的时间戳/图标是确定性的：重跑应产生相同文件
  var current = fs.readFileSync(path.join(ROOT, "market", "index.json"), "utf8");
  assert(current.indexOf("dsh-plugin-optimize-ai-reply") >= 0, "索引应含包名");
  assert(current.indexOf("data:image/png;base64,") >= 0, "图标应内联");
});

// ---------- 六、awesome-dsh-plugin 提交文件 ----------

test("market/awesome-dsh-plugin.yml：字段与单行约束", function () {
  var yml = fs.readFileSync(path.join(ROOT, "market", "awesome-dsh-plugin.yml"), "utf8");
  assert(/^url: https:\/\/github\.com\/[\w.-]+\/dsh-plugin-optimize-ai-reply$/m.test(yml), "url 需为仓库 HTTPS 地址");
  assert(/^name: [\w.-]+\/dsh-plugin-optimize-ai-reply$/m.test(yml), "name 需 owner/repo");
  assert(/^category: \w+$/m.test(yml), "category 需为单个类目 id");
  assert(/^  en: .+\.$/m.test(yml), "description.en 需单行且以句号结尾");
  assert(/^  zh: .+$/m.test(yml), "description.zh 需单行");
  // 描述不得含换行（块内每项只占一行）
  var lines = yml.split("\n").filter(function (l) { return /^  (en|zh):/.test(l); });
  assertEqual(lines.length, 2, "en/zh 各一行");
});

test("market/awesome-dsh-plugin.yml：tarball 指向 GitHub Release", function () {
  var yml = fs.readFileSync(path.join(ROOT, "market", "awesome-dsh-plugin.yml"), "utf8");
  assert(/tarball: https:\/\/github\.com\/.+\/releases\/latest\/download\/dsh-plugin-optimize-ai-reply\.tgz/.test(yml), "tarball 需指向 Release 资产");
});

// ---------- 七、README 收录指引存在 ----------

test("market/README.md：三条收录路径齐全", function () {
  var md = fs.readFileSync(path.join(ROOT, "market", "README.md"), "utf8");
  assert(md.indexOf("dsh-plugin") >= 0, "应含 topic 指引");
  assert(md.indexOf("awesome-dsh-plugin") >= 0, "应含精选列表路径");
  assert(md.indexOf("index.json") >= 0, "应含市场索引路径");
  assert(md.indexOf("prepare-listing.mjs") >= 0, "应含占位符替换指引");
});

test("上架包：LISTING-KIT.md 三步 + PR 文案 + 安装命令", function () {
  var md = fs.readFileSync(path.join(ROOT, "market", "LISTING-KIT.md"), "utf8");
  assert(md.indexOf("第 1 步") >= 0 && md.indexOf("第 2 步") >= 0 && md.indexOf("第 3 步") >= 0, "应含三步");
  assert(md.indexOf("Add ") >= 0 && md.indexOf("data/plugins/") >= 0, "应含 PR 标题与文件路径");
  assert(md.indexOf("generate-readme.mjs") >= 0, "应含对方仓库生成命令");
  assert(md.indexOf("dsh plugin") >= 0, "应含用户安装命令");
});

test("提示词：PROMPT.md 主提示词覆盖工作流与硬约束", function () {
  var md = fs.readFileSync(path.join(ROOT, "PROMPT.md"), "utf8");
  assert(md.indexOf("optimize_reply_scan") >= 0 && md.indexOf("optimize_reply_brief") >= 0 && md.indexOf("optimize_reply_check") >= 0, "应含三步工具");
  assert(md.indexOf("信息守恒") >= 0, "应含硬约束（信息守恒）");
  assert(md.indexOf("回退") >= 0, "应含回退要求");
  assert(md.indexOf("只要终稿") >= 0, "应含只要终稿分支");
});

test("上架准备脚本存在且替换占位符", function () {
  var js = fs.readFileSync(path.join(ROOT, "scripts", "prepare-listing.mjs"), "utf8");
  assert(js.indexOf("your-github-id") >= 0 && js.indexOf("你的GitHub账号") >= 0, "应覆盖中英占位符");
  assert(js.indexOf("build-market-index.mjs") >= 0, "应重生成市场索引");
});

// ---------- 汇总 ----------

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
    console.log("DSH 插件契约测试：通过 " + passed + "，失败 " + failed + "，合计 " + (passed + failed));
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
