/**
 * tools.js —— DSH 工具层：把 L0–L6 流水线注册为 harness 工具
 * 设计：agent 自己做改写（L3），插件用确定性工具把住三道关：
 *   optimize_reply_scan（L2 密度扫描）→ agent 按 optimize_reply_brief 改写 → optimize_reply_check（L4 校验 + L5 闭环）
 * 全部本地零网络；不引入第三方「AI 检测器」；不让模型给文本打「AI 味分」。
 */
"use strict";

var Scan = require("../core/scan.js");
var Verify = require("../core/verify.js");
var Rewrite = require("../core/rewrite.js");
var Rescan = require("../core/rescan.js");
var Prompts = require("../core/prompts.js");
var Rulecheck = require("../core/rulecheck.js");
var rulesJson = require("../core/rules.json");

// 宿主提供真 defineTool（@deepseek-ai/dsh-tools）；离线/单测/软链接安装退化为透传。
// 透传实现必须把作者侧参数 DSL 编译为 JSON Schema（与 defineTool 的编译结果同形）：
// 注册表把 definition.parameters 直接作为函数 schema 交给模型 API，
// 原样透传 DSL map 会被 API 以 'type: null' 拒绝。
function fieldToJsonSchema(field) {
  var node = { type: field.type };
  if (field.description !== undefined) node.description = field.description;
  if (field.title !== undefined) node.title = field.title;
  if (field.default !== undefined) node.default = field.default;
  if (field.examples !== undefined) node.examples = field.examples;
  if (field.enum !== undefined) node.enum = field.enum.slice();
  if (field.const !== undefined) node.const = field.const;
  if (field.type === "array" && field.items) node.items = fieldToJsonSchema(field.items);
  if (field.type === "object" && field.properties) {
    var compiled = compilePropertyMap(field.properties);
    node.properties = compiled.properties;
    if (compiled.required) node.required = compiled.required;
    if (field.additionalProperties !== undefined) node.additionalProperties = field.additionalProperties;
  }
  return node;
}

function compilePropertyMap(params) {
  var properties = {};
  var required = [];
  for (var key in params) {
    var field = params[key];
    // 与 defineTool 的编译期规则一致：可选参数省略 required，写成 false 会被宿主拒绝
    if (field.required !== undefined && field.required !== true) {
      throw new Error("unsupported JSON schema: parameters." + key + ".required must be true when present");
    }
    properties[key] = fieldToJsonSchema(field);
    if (field.required) required.push(key);
  }
  return { properties: properties, required: required.length ? required : undefined };
}

function compileParameters(params) {
  var compiled = compilePropertyMap(params || {});
  var schema = { type: "object", properties: compiled.properties };
  if (compiled.required) schema.required = compiled.required;
  return schema;
}

function resolveDefineTool() {
  try {
    var mod = require("@deepseek-ai/dsh-tools");
    if (mod && typeof mod.defineTool === "function") return mod.defineTool;
  } catch (err) {
    // 离线环境：使用透传实现
  }
  return function defineToolShim(def) {
    var out = {};
    for (var k in def) out[k] = def[k];
    out.parameters = compileParameters(def.parameters);
    if (def.output && def.output.schema) {
      out.output = {
        schema: fieldToJsonSchema(def.output.schema),
        render: def.output.render
      };
      if (def.output.presentationMeta) out.output.presentationMeta = def.output.presentationMeta;
    }
    return out;
  };
}

var TEXT_OUTPUT = {
  schema: { type: "string" },
  render: function (_args, value) {
    return [{ type: "text", text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }];
  }
};

function json(value) {
  return JSON.stringify(value, null, 2);
}

// ---------- 总开关（volatile 配置，DSH 界面「插件 → 优化 AI 回复 → 配置」） ----------

// 配置值可能是稳定引用（宿主 Loader 热更新）或普通值（离线/单测），统一读取
function readValue(v) {
  return v && typeof v.get === "function" ? v.get() : v;
}

var DISABLED_NOTICE = {
  status: "disabled",
  message:
    "「优化 AI 回复」总开关已关闭，本工具暂停工作。" +
    "如需启用：DSH 侧栏「插件」→「优化 AI 回复」→ 配置 → 打开「启用优化」。" +
    "请不要重复调用本插件工具，直接按常规完成任务。"
};

function pickRules(disabled) {
  if (!disabled || !disabled.length) return rulesJson;
  var set = {};
  for (var i = 0; i < disabled.length; i++) set[disabled[i]] = true;
  var copy = JSON.parse(JSON.stringify(rulesJson));
  for (var j = 0; j < copy.rules.length; j++) {
    if (set[copy.rules[j].id]) copy.rules[j].enabled = false;
  }
  return copy;
}

function scanToReport(res) {
  // 控制输出体量：spans 截断，观察项只留前 10 条
  var stats = res.stats.map(function (s) {
    return {
      id: s.id,
      variantId: s.variantId,
      name: s.name,
      hits: s.hits,
      density: s.density,
      human: s.human,
      ai: s.ai,
      ratio: s.ratio,
      unit: s.unit,
      level: s.level,
      focus: s.focus,
      stale: s.stale,
      conditional: s.conditional,
      advice: s.advice,
      boundary: s.boundary,
      sampleSpans: (s.spans || []).slice(0, 3).map(function (sp) {
        return sp.text;
      })
    };
  });
  return {
    documentFlag: Scan.documentFlag(res).flagged ? "偏高（存在达到阈值的特征）" : "正常（未达阈值）",
    elevated: Scan.documentFlag(res).elevated.map(function (s) {
      return s.id + (s.variantId ? "/" + s.variantId : "");
    }),
    stats: stats.filter(function (s) {
      return s.hits > 0;
    }),
    watchlist: res.watchlist.slice(0, 10),
    format: res.format,
    meta: res.meta
  };
}

/**
 * 构造全部工具定义。config 为已校验的插件配置。
 */
function buildTools(config) {
  var defineTool = resolveDefineTool();
  var defaults = {
    register: readValue(config.defaultRegister) || "qa",
    model: readValue(config.defaultModel) || "unknown",
    threshold: typeof readValue(config.thresholdMultiplier) === "number" ? readValue(config.thresholdMultiplier) : 2
  };
  var rules = pickRules(readValue(config.disabledRules));

  // 总开关：每次调用实时读取（界面开/关即时生效，无需重载插件）
  function isEnabled() {
    return readValue(config.enabled) !== false;
  }
  function tool(def) {
    var run = def.execute;
    var name = def.name;
    def.execute = async function (args) {
      if (!isEnabled()) {
        return name === "optimize_reply_style_prompt"
          ? "「优化 AI 回复」已关闭：本次写作不做任何风格干预，请直接按常规方式完成写作。"
          : json(DISABLED_NOTICE);
      }
      return run(args);
    };
    return defineTool(def);
  }

  var tools = [];

  // ---------- L2 本地扫描 ----------
  tools.push(
    tool({
      name: "optimize_reply_scan",
      description:
        "本地扫描文本的 AI 写作特征（密度对照人类基线，零网络、纯统计）。" +
        "返回每项特征的命中数/密度/人类基线/AI 基线/倍率/判断（正常·观察项·偏高·高）。" +
        "Use this first to see which AI-writing traits exceed human baselines; it never changes the text.",
      parameters: {
        text: { type: "string", required: true, description: "要扫描的文本（中/英文）" },
        register: {
          type: "string",
          description: "文体：qa|social|script|popular|formal|academic，默认取插件配置"
        },
        model: {
          type: "string",
          description: "出稿模型 id：gpt|claude|deepseek|gemini|kimi|qwen|doubao|gpt-legacy|claude-early|unknown"
        },
        threshold: { type: "number", description: "触发阈值（人类基线 × N），默认 2" }
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        var res = Scan.scan(
          args.text,
          args.register || defaults.register,
          args.model || defaults.model,
          rules,
          { thresholdMultiplier: args.threshold || defaults.threshold }
        );
        return json(scanToReport(res));
      }
    })
  );

  // ---------- L3 改写任务书 ----------
  tools.push(
    tool({
      name: "optimize_reply_brief",
      description:
        "生成「优化 AI 回复」改写任务书（提示词 B）：硬约束 + 人类语言逻辑改写法 + 本次命中的特征清单 + 改写强度 + 输出格式。" +
        "若返回「无需改写」则原文已经达标。否则你（模型）就是改写器：按任务书重写语言逻辑，改写后必须调用 optimize_reply_check 校验，" +
        "不通过就回退原文。Produces the rewrite brief (hard constraints + human-language-logic rewrite method + targeted hits + strength); you perform the rewrite, then verify.",
      parameters: {
        text: { type: "string", required: true, description: "原文" },
        register: { type: "string", description: "文体，同 optimize_reply_scan" },
        model: { type: "string", description: "出稿模型 id，同 optimize_reply_scan" },
        threshold: { type: "number", description: "触发阈值，默认 2" },
        strength: {
          type: "string",
          description: "改写强度：safe（只动命中句）|strong（重构命中段落，默认）|max（整段语言逻辑重写）；不传取插件配置"
        }
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        var register = args.register || defaults.register;
        var model = args.model || defaults.model;
        var strength = Prompts.normalizeStrength(args.strength || readValue(config.rewriteStrength));
        var scanRes = Scan.scan(args.text, register, model, rules, {
          thresholdMultiplier: args.threshold || defaults.threshold
        });
        var targets = scanRes.stats.filter(function (s) {
          return s.level === "elevated" || s.level === "high";
        });
        if (!targets.length) {
          return [
            "无需改写：本次没有达到阈值的特征（" + scanRes.watchlist.length + " 项观察项未达阈值，默认不改）。",
            "没有任何命中项就不要动文本——「少改」是第一原则，只汇报扫描摘要即可。"
          ].join("\n");
        }
        var brief = Prompts.buildRewriteMessages(args.text, targets, register, model, { strength: strength });
        return [
          brief,
          "",
          "——————",
          "【工作流要求】你改写完成后：",
          "1. 输出终稿文本（只输出终稿，不要解释）；",
          "2. 立即调用 optimize_reply_check（before=原文，after=你的终稿）；",
          "3. 结果为 revert 时，必须放弃改动、原样回退原文，并转告原因；",
          "4. 严禁在改写中引入原文没有的事实、数字、经历（信息守恒）；",
          "5. 改写的是「说话的思路」：按任务书第二节重排信息流、拆合句子、换动词与连接，不要只把词表上的词换成同义词。"
        ].join("\n");
      }
    })
  );

  // ---------- L4 三层校验 ----------
  tools.push(
    tool({
      name: "optimize_reply_verify",
      description:
        "五层校验改写结果：事实（数字/URL/代码/引文/专名）、论断强度与主次、安全信息、结构。" +
        "任一违规即 fail。Deterministic guard: verify(before, after) — fails on any fact/strength/safety drift.",
      parameters: {
        before: { type: "string", required: true, description: "原文" },
        after: { type: "string", required: true, description: "改写后文本" }
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        var v = Verify.verify(args.before, args.after);
        return json({ ok: v.ok, violations: v.violations.map(function (x) { return { layer: x.layer, message: x.message }; }) });
      }
    })
  );

  // ---------- L5 闭环复扫 ----------
  tools.push(
    tool({
      name: "optimize_reply_rescan",
      description:
        "闭环复扫：改写结果重新扫描，要求被处理项密度下降且不引入新的「偏高/高」项（如把破折号换成「说白了」会被拦下）。" +
        "Closed loop: the rewrite must reduce targeted densities and introduce no new elevated traits.",
      parameters: {
        before: { type: "string", required: true, description: "原文" },
        after: { type: "string", required: true, description: "改写后文本" },
        register: { type: "string", description: "文体，同 optimize_reply_scan" },
        model: { type: "string", description: "出稿模型 id，同 optimize_reply_scan" }
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        var register = args.register || defaults.register;
        var model = args.model || defaults.model;
        var scanBefore = Scan.scan(args.before, register, model, rules, {});
        var rc = Rescan.rescan(args.before, args.after, scanBefore, {
          register: register,
          model: model,
          rules: rules
        });
        return json({
          ok: rc.ok,
          reason: rc.reason,
          resolved: rc.resolved,
          notImproved: rc.notImproved,
          newElevated: rc.newElevated
        });
      }
    })
  );

  // ---------- L4 + L5 合一（推荐工作流用） ----------
  tools.push(
    tool({
      name: "optimize_reply_check",
      description:
        "一站式验收改写：内部执行 optimize_reply_verify + optimize_reply_rescan，返回 action=accept 或 revert 及原因。" +
        "改写后必调；revert 时必须回退原文。One call after rewriting: accept or revert with reasons.",
      parameters: {
        before: { type: "string", required: true, description: "原文" },
        after: { type: "string", required: true, description: "改写后文本" },
        register: { type: "string", description: "文体，同 optimize_reply_scan" },
        model: { type: "string", description: "出稿模型 id，同 optimize_reply_scan" }
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        var register = args.register || defaults.register;
        var model = args.model || defaults.model;
        var v = Verify.verify(args.before, args.after);
        var reasons = [];
        if (!v.ok) {
          for (var i = 0; i < v.violations.length; i++) {
            reasons.push("[" + v.violations[i].layer + "] " + v.violations[i].message);
          }
        }
        var rc = null;
        if (v.ok) {
          var scanBefore = Scan.scan(args.before, register, model, rules, {});
          rc = Rescan.rescan(args.before, args.after, scanBefore, {
            register: register,
            model: model,
            rules: rules
          });
          if (!rc.ok) reasons.push("[rescan] " + rc.reason);
        }
        var ok = v.ok && rc && rc.ok;
        return json({
          action: ok ? "accept" : "revert",
          ok: !!ok,
          reasons: reasons,
          verify: { ok: v.ok, violations: v.violations.length },
          rescan: rc ? { ok: rc.ok, resolved: rc.resolved.length, newElevated: rc.newElevated.length } : null,
          instruction: ok ? "可以采用改写稿。" : "必须放弃改动、原样回退原文，并向用户说明原因。"
        });
      }
    })
  );

  // ---------- L1 生成侧提示词 ----------
  tools.push(
    tool({
      name: "optimize_reply_style_prompt",
      description:
        "返回「生成侧」写作风格要求（提示词 A）：写新内容前采用它，从源头少写 AI 味。" +
        "可注入 system prompt 或作为写作规范。Returns the generation-side style rules to apply BEFORE writing.",
      parameters: {
        task: { type: "string", description: "可选：写作任务描述，会附在提示词后" }
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        return Rewrite.generationPrompt(args.task || "");
      }
    })
  );

  // ---------- 规则体检 ----------
  tools.push(
    tool({
      name: "optimize_reply_rulecheck",
      description:
        "跑内置回归语料（40 段真人 + 20 段 AI），输出每条规则的误报率、AI 检出率与维护建议。" +
        "规则改动后的回归工具；误报率 >5% 的规则不建议启用。Regression check over the built-in corpus.",
      parameters: {
        includeCorpusStats: {
          type: "boolean",
          description: "是否附带逐条完整统计（默认 false，只给命中规则）"
        }
      },
      output: TEXT_OUTPUT,
      async execute(args) {
        var fs = require("fs");
        var path = require("path");
        function loadCorpus(file) {
          return JSON.parse(fs.readFileSync(path.join(__dirname, "..", "corpus", file), "utf8"));
        }
        var humanZh = loadCorpus("human-zh.json");
        var humanEn = loadCorpus("human-en.json");
        var aiZh = loadCorpus("ai-zh.json");
        var aiEn = loadCorpus("ai-en.json");
        var human = humanZh.concat(humanEn).map(function (d) {
          return { id: d.id, register: Rulecheck.KIND_REGISTER[d.kind] || "qa", model: "unknown", text: d.text };
        });
        var ai = aiZh.concat(aiEn).map(function (d) {
          return { id: d.id, register: "qa", model: d.model || "unknown", text: d.text };
        });
        var rep = Rulecheck.rulecheck(human, ai, { rules: rules });
        var rows = args.includeCorpusStats
          ? rep.rules
          : rep.rules.filter(function (r) {
              return r.humanFlagged > 0 || r.aiFlagged > 0;
            });
        return json({ summary: rep.summary, rules: rows });
      }
    })
  );

  return tools;
}

module.exports = {
  buildTools: buildTools,
  DISABLED_NOTICE: DISABLED_NOTICE,
  TOOL_NAMES: [
    "optimize_reply_scan",
    "optimize_reply_brief",
    "optimize_reply_verify",
    "optimize_reply_rescan",
    "optimize_reply_check",
    "optimize_reply_style_prompt",
    "optimize_reply_rulecheck"
  ]
};
