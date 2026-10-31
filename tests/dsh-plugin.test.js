/**
 * dsh-plugin.test.js —— DeepSeek Harness 插件契约测试（零依赖）
 * 覆盖：入口导出、Standard Schema 配置、7 个工具注册与执行、
 *       界面开关（volatile 配置 · schemastery 兼容信封 · 总开关门控 · 客户端开关页）、
 *       bundle 契约（package.json dsh.bundle / dsh.client / cordis.patch.yml / engines.dsh）、
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

test("工具参数 schema：编译为 object 根 JSON Schema（模型 API 契约）", function () {
  var ctx = fakeCtx();
  plugin.apply(ctx, undefined);
  assertEqual(ctx.registered.length, 7);
  ctx.registered.forEach(function (t) {
    assertEqual(t.parameters.type, "object", t.name + " 参数应为 object 根");
    assert(t.parameters.properties && typeof t.parameters.properties === "object", t.name + " 应有 properties");
    Object.keys(t.parameters.properties).forEach(function (k) {
      var p = t.parameters.properties[k];
      assert(typeof p.type === "string", t.name + "." + k + " 应有编译后的 type");
    });
    (t.parameters.required || []).forEach(function (k) {
      assert(t.parameters.properties[k], t.name + " required 项应存在：" + k);
    });
    assert(t.output && t.output.schema && t.output.schema.type === "string", t.name + " 输出 schema 应编译为 string");
  });
});

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

test("optimize_reply_brief：干净文本 → 无需改写；命中文本 → 含硬约束、语言逻辑与强度", function () {
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
      assert(dirty.indexOf("人类语言逻辑") >= 0, "应含人类语言逻辑章节");
      assert(dirty.indexOf("【改写强度】max") >= 0, "默认强度应为 max");
      assert(dirty.indexOf("信息流") >= 0, "应要求重排信息流");
      return brief.execute({
        text: "综上所述，这一突破标志着行业进入了新的高度。说白了，这不是效率问题，而是流程设计的问题。",
        strength: "max"
      });
    })
    .then(function (maxBrief) {
      assert(maxBrief.indexOf("【改写强度】max") >= 0, "应按参数输出 max 档");
      assert(maxBrief.indexOf("重构命中段落") >= 0, "max 档应说明可整段重写");
    });
});

test("配置：rewriteStrength 默认 max，非法值拒绝", function () {
  var ok = plugin.Config["~standard"].validate(undefined);
  assertEqual(ok.value.rewriteStrength, "max");
  var custom = plugin.Config["~standard"].validate({ rewriteStrength: "safe" });
  assertEqual(custom.value.rewriteStrength, "safe");
  var bad = plugin.Config["~standard"].validate({ rewriteStrength: "ultra" });
  assert(bad.issues && bad.issues.length > 0, "非法强度应报错");
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
      assert(/^https:\/\//.test(v.source.url) && /^[0-9a-f]{40}$/.test(v.source.commit), "git 源需 https url + 40 位 commit");
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

// ---------- 八、界面开关：volatile 配置（schemastery 兼容） ----------

var schemaMod = require(path.join(ROOT, "src", "dsh", "schema.js"));
var VOL_WRITE = Symbol.for("cosmokit.volatile.write");

test("开关配置：enabled 默认为 true 且以稳定引用交付", function () {
  var res = plugin.Config["~standard"].validate(undefined);
  assert(res.value, "应通过校验");
  assert(schemaMod.isVolatileRef(res.value.enabled), "enabled 应为 volatile 引用");
  assertEqual(res.value.enabled.get(), true, "默认应开启");
  assertEqual(schemaMod.unwrap(res.value.defaultRegister), "qa", "普通字段应为普通值");
});

test("开关配置：显式 enabled=false 解析为引用且读取为 false", function () {
  var res = plugin.Config["~standard"].validate({ enabled: false });
  assert(res.value, "应通过：" + JSON.stringify(res.issues));
  assertEqual(res.value.enabled.get(), false);
});

test("开关配置：enabled 非法类型报 issues", function () {
  var bad = plugin.Config["~standard"].validate({ enabled: "yes" });
  assert(bad.issues && bad.issues.length > 0, "布尔字段应拒收字符串");
});

test("开关配置：宿主写回协议可热更新引用（界面开关即时生效的基础）", function () {
  var res = plugin.Config["~standard"].validate({ enabled: true });
  var ref = res.value.enabled;
  ref[VOL_WRITE](false);
  assertEqual(ref.get(), false, "共享写协议应更新引用");
  assert(schemaMod.isVolatileRef(ref), "更新后仍是同一引用对象");
});

test("schema：schemastery 兼容信封 {uid, refs} 可被消费方重建", function () {
  var envelope = plugin.Config.toJSON();
  assert(typeof envelope.uid === "number", "信封应含 uid");
  assert(envelope.refs && typeof envelope.refs === "object", "信封应含 refs 图");
  // 消费方最小重建器（镜像真实 schemastery 的 new Schema({uid, refs}) 链接语义）
  var map = {};
  Object.keys(envelope.refs).forEach(function (uid) {
    var src = envelope.refs[uid];
    var node = { type: src.type, meta: JSON.parse(JSON.stringify(src.meta)) };
    if (src.dict) node.dict = src.dict;
    if (src.inner) node.inner = src.inner;
    if (src.list) node.list = src.list;
    map[uid] = node;
  });
  Object.keys(map).forEach(function (uid) {
    var node = map[uid];
    if (node.dict) {
      var d = {};
      Object.keys(node.dict).forEach(function (k) {
        assert(typeof node.dict[k] === "number", "dict 嵌套引用应为 uid 数字");
        d[k] = map[node.dict[k]];
      });
      node.dict = d;
    }
    if (node.inner) node.inner = map[node.inner];
  });
  var root = map[envelope.uid];
  assertEqual(root.type, "object");
  assert(root.dict.enabled.meta.volatile === true, "enabled 节点应带 volatile 标记");
  assertEqual(root.dict.enabled.meta.default, true);
  assertEqual(root.dict.enabled.type, "boolean");
  assertEqual(root.dict.disabledRules.inner.type, "string", "数组字段应有元素类型");
  // meta 深拷贝：消费方就地删除 volatile 标记不得污染原 schema
  delete root.dict.enabled.meta.volatile;
  assert(plugin.Config.dict.enabled.meta.volatile === true, "原 schema 的 volatile 标记应保留");
});

test("schema：vendor 标记为 schemastery（Loader/settings 识别即时字段的前提）", function () {
  assertEqual(plugin.Config["~standard"].vendor, "schemastery");
  assert(plugin.Config["~standard"].version === 1, "Standard Schema v1");
  assertEqual(plugin.Config.type, "object");
  assert(plugin.Config.dict && plugin.Config.dict.enabled, "结构面应暴露 dict");
});

// ---------- 九、总开关门控 ----------

test("总开关关闭：7 个工具全部返回暂停通知，不执行流水线", function () {
  var ctx = fakeCtx();
  var cfg = plugin.Config["~standard"].validate({ enabled: false }).value;
  plugin.apply(ctx, cfg);
  var args = [
    { text: "综上所述，这一突破标志着行业进入了新的高度。" },
    { text: "综上所述，这一突破标志着行业进入了新的高度。" },
    { before: "有效率 82%。", after: "有效率 85%。" },
    { before: "先看日志。", after: "先看日志。" },
    { before: "先看日志。", after: "先看日志。" },
    { task: "写部署说明" },
    {}
  ];
  var chain = Promise.resolve();
  ctx.registered.forEach(function (t, i) {
    chain = chain.then(function () {
      return t.execute(args[i] || {}).then(function (out) {
        if (t.name === "optimize_reply_style_prompt") {
          assert(out.indexOf("已关闭") >= 0, t.name + " 应提示开关已关闭");
        } else {
          var rep = JSON.parse(out);
          assertEqual(rep.status, "disabled", t.name + " 应返回 disabled");
          assert(rep.message.indexOf("启用优化") >= 0 || rep.message.indexOf("插件") >= 0, t.name + " 应给出开启路径");
        }
      });
    });
  });
  return chain;
});

test("总开关热更新：引用写回后工具立即恢复、再关闭立即暂停", function () {
  var ctx = fakeCtx();
  var cfg = plugin.Config["~standard"].validate({ enabled: false }).value;
  plugin.apply(ctx, cfg);
  var scan = toolByName(ctx, "optimize_reply_scan");
  return scan
    .execute({ text: "综上所述，这一突破标志着行业进入了新的高度。" })
    .then(function (offOut) {
      assertEqual(JSON.parse(offOut).status, "disabled", "关闭时应暂停");
      cfg.enabled[VOL_WRITE](true); // 模拟 Loader 界面写回
      return scan.execute({ text: "综上所述，这一突破标志着行业进入了新的高度。" });
    })
    .then(function (onOut) {
      var rep = JSON.parse(onOut);
      assert(rep.stats, "开启后应恢复扫描报告");
      cfg.enabled[VOL_WRITE](false);
      return scan.execute({ text: "综上所述，这一突破标志着行业进入了新的高度。" });
    })
    .then(function (againOut) {
      assertEqual(JSON.parse(againOut).status, "disabled", "再次关闭应立即暂停");
    });
});

test("总开关离线兼容：普通布尔值同样生效", function () {
  var ctx = fakeCtx();
  plugin.apply(ctx, { enabled: false });
  return toolByName(ctx, "optimize_reply_scan")
    .execute({ text: "综上所述，这一突破标志着行业进入了新的高度。" })
    .then(function (out) {
      assertEqual(JSON.parse(out).status, "disabled", "普通 false 也应暂停");
    });
});

// ---------- 十、客户端半侧（DSH 界面开关页） ----------

test("客户端产物：lib/client.js 存在且与源码一致", function () {
  var built = fs.readFileSync(path.join(ROOT, "lib", "client.js"), "utf8");
  var src = fs.readFileSync(path.join(ROOT, "src", "client", "index.js"), "utf8");
  assertEqual(built, src, "lib/client.js 应为 src/client/index.js 原样拷贝");
  assert(built.indexOf("window.__ModuleLoader__.load") >= 0, "应为懒加载 CJS 工厂格式");
});

function loadClientModule() {
  var src = fs.readFileSync(path.join(ROOT, "lib", "client.js"), "utf8");
  var captured = null;
  var win = {
    __ModuleLoader__: {
      load: function (m) {
        captured = m;
      }
    }
  };
  new Function("window", src)(win);
  return captured;
}

function loadClientExports() {
  var mod = loadClientModule();
  var required = [];
  var switchStub = function Switch() {};
  var stubs = {
    react: {
      useState: function (init) {
        return [typeof init === "function" ? init() : init, function () {}];
      },
      useEffect: function (fn) {
        fn();
      }
    },
    "react/jsx-runtime": {
      jsx: function (type, props) {
        return { jsxType: type, props: props };
      },
      jsxs: function (type, props) {
        return { jsxType: type, props: props };
      }
    },
    "@deepseek-ai/dsh-client-ui-primitives": { Switch: switchStub }
  };
  var req = function (name) {
    required.push(name);
    if (stubs[name]) return stubs[name];
    throw new Error("客户端产物请求了基座之外的模块：" + name);
  };
  var exp = mod.factory(req);
  return { mod: mod, exp: exp, required: required, switchStub: switchStub, stubs: stubs };
}

function fakeScope(snapshot) {
  var calls = [];
  var listeners = [];
  var snap = snapshot;
  return {
    calls: calls,
    setSnapshot: function (next) {
      snap = next;
      listeners.forEach(function (l) {
        l();
      });
    },
    getSnapshot: function () {
      return snap;
    },
    subscribe: function (l) {
      listeners.push(l);
      return function () {};
    },
    set: function (field, value) {
      calls.push([field, value]);
      return Promise.resolve(true);
    }
  };
}

function fakeClientCtx(scope) {
  var records = { locales: [], slots: [], entryId: null, effects: [] };
  return {
    records: records,
    locale: {
      bind: function () {
        return function (k) {
          return k;
        };
      },
      register: function (ns, dicts) {
        records.locales.push({ ns: ns, dicts: dicts });
        return function () {};
      }
    },
    configForms: {
      get: function (id) {
        records.entryId = id;
        return scope;
      }
    },
    slots: {
      inject: function (name, factory) {
        records.slots.push({ name: name, reg: factory() });
        return function () {};
      },
      register: function (desc, comp) {
        return { desc: desc, comp: comp };
      }
    },
    effect: function (fn, label) {
      records.effects.push(label);
      fn();
    },
    logger: { info: function () {} }
  };
}

test("客户端产物：模块形状（id / exports / 基座依赖白名单）", function () {
  var got = loadClientExports();
  assertEqual(got.mod.id, "dsh-plugin-optimize-ai-reply", "bundle id 应为包名");
  assertEqual(got.exp.NS, "optimize-ai-reply.config");
  assertEqual(JSON.stringify(got.exp.inject), JSON.stringify(["slots", "locale", "configForms"]));
  assert(typeof got.exp.apply === "function", "应导出 apply");
  var allowed = ["react", "react/jsx-runtime", "@deepseek-ai/dsh-client-ui-primitives"];
  got.required.forEach(function (name) {
    assert(allowed.indexOf(name) >= 0, "只允许请求基座模块：" + name);
  });
});

test("客户端开关页：注册字典 + 两个 slot（组合包配置区与行配置区）", function () {
  var got = loadClientExports();
  var scope = fakeScope({ status: "ready", value: { enabled: true }, writable: true });
  var ctx = fakeClientCtx(scope);
  got.exp.apply(ctx);
  assertEqual(ctx.records.entryId, "optimize-ai-reply", "settings 命名空间应为 Loader 条目 id");
  assertEqual(ctx.records.locales.length, 1);
  assertEqual(ctx.records.locales[0].ns, "optimize-ai-reply.config");
  assertEqual(ctx.records.locales[0].dicts.zh.title, "优化 AI 回复");
  assertEqual(ctx.records.locales[0].dicts.en.title, "Optimize AI Reply");
  assertEqual(ctx.records.slots.length, 2, "应注册两个配置区");
  var byName = {};
  ctx.records.slots.forEach(function (s) {
    byName[s.name] = s.reg;
  });
  assert(byName["plugins.bundle.config"], "应注册组合包配置区");
  assertEqual(byName["plugins.bundle.config"].desc.key, "dsh-plugin-optimize-ai-reply");
  assert(byName["plugins.row.config"], "应注册行配置区");
  assertEqual(byName["plugins.row.config"].desc.key, "dsh-plugin-optimize-ai-reply#optimize-ai-reply");
  assertEqual(byName["plugins.row.config"].desc.locale, "optimize-ai-reply.config");
});

test("客户端开关页：summary 视图一行文案，page 视图渲染开关", function () {
  var got = loadClientExports();
  var dicts = null;
  var scope = fakeScope({ status: "ready", value: { enabled: true }, writable: true });
  var ctx = fakeClientCtx(scope);
  got.exp.apply(ctx);
  dicts = ctx.records.locales[0].dicts;
  var comp = ctx.records.slots[0].reg.comp;
  var t = function (k) {
    return dicts.zh[k] || k;
  };
  assertEqual(comp({ t: t, view: "summary" }), dicts.zh.summary, "summary 应为一行文案");
  var tree = comp({ t: t, view: "page" });
  var children = tree.props.children;
  var sw = children[1];
  assertEqual(sw.jsxType, got.switchStub, "应渲染共享 Switch 组件");
  assertEqual(sw.props.checked, true, "开启时开关应为开");
  assertEqual(sw.props.label, "启用优化");
  assertEqual(children[0].props.children[2].props.children, dicts.zh.statusOn, "状态行应显示已启用");
});

test("客户端开关页：关闭状态呈现 + 开关写回 settings", function () {
  var got = loadClientExports();
  var scope = fakeScope({ status: "ready", value: { enabled: false }, writable: true });
  var ctx = fakeClientCtx(scope);
  got.exp.apply(ctx);
  var dicts = ctx.records.locales[0].dicts;
  var comp = ctx.records.slots[0].reg.comp;
  var t = function (k) {
    return dicts.zh[k] || k;
  };
  var tree = comp({ t: t, view: "page" });
  var sw = tree.props.children[1];
  assertEqual(sw.props.checked, false, "关闭时开关应为关");
  assertEqual(tree.props.children[0].props.children[2].props.children, dicts.zh.statusOff);
  sw.props.onChange(true);
  // 写回走微任务链，让出一个宏任务后核对
  return new Promise(function (resolve) {
    setTimeout(resolve, 0);
  }).then(function () {
    assertEqual(scope.calls.length, 1, "应写回一次");
    assertEqual(scope.calls[0][0], "enabled");
    assertEqual(scope.calls[0][1], true, "应写回新值");
  });
});

test("客户端开关页：未加载/只读时开关禁用", function () {
  var got = loadClientExports();
  var scope = fakeScope({ status: "unavailable", value: undefined, writable: false });
  var ctx = fakeClientCtx(scope);
  got.exp.apply(ctx);
  var dicts = ctx.records.locales[0].dicts;
  var comp = ctx.records.slots[0].reg.comp;
  var t = function (k) {
    return dicts.zh[k] || k;
  };
  var tree = comp({ t: t, view: "page" });
  var sw = tree.props.children[1];
  assertEqual(sw.props.disabled, true, "未加载或只读时应禁用");
  assertEqual(tree.props.children[0].props.children[2].props.children, dicts.zh.unavailable);
});

test("bundle：dsh.client 契约（platform web + 服务注入 + ./client 导出）", function () {
  var pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert(pkg.dsh.client, "应声明 dsh.client");
  assertEqual(pkg.dsh.client.platform, "web");
  assertEqual(
    JSON.stringify(pkg.dsh.client.inject),
    JSON.stringify([
      "@deepseek-ai/dsh-client-locale",
      "@deepseek-ai/dsh-client-ui-settings",
      "@deepseek-ai/dsh-client-ui-plugin-manager"
    ])
  );
  assertEqual(pkg.exports["./client"].default, "./lib/client.js", "应导出 ./client");
  assert(pkg.files.indexOf("lib/") >= 0, "files 应含 lib/");
  assert(fs.existsSync(path.join(ROOT, "lib", "client.js")), "lib/client.js 应存在");
  assert(pkg.files.indexOf("src/client/") >= 0, "files 应含客户端源码");
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
