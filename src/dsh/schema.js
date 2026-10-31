/**
 * schema.js —— 插件配置的 Standard Schema v1 实现（零依赖）
 * Cordis 要求导出的 Config 实现 Standard Schema 接口（不是普通对象）。
 * 这里手写一个最小实现：类型校验 + 默认值 + 可读错误；宿主的 schemastery 不是必需品。
 */
"use strict";

var REGISTERS = ["qa", "social", "script", "popular", "formal", "academic"];

var FIELDS = {
  defaultRegister: {
    type: "string",
    enum: REGISTERS,
    default: "qa",
    desc: "默认文体档位（问答对话/社媒/口播台词/科普长文/正式文书/学术）"
  },
  defaultModel: {
    type: "string",
    default: "unknown",
    desc: "默认出稿模型 id（gpt/claude/deepseek/gemini/kimi/qwen/doubao/…）"
  },
  thresholdMultiplier: {
    type: "number",
    min: 1,
    max: 10,
    default: 2,
    desc: "触发阈值：密度 ≥ 人类基线 × N 判「偏高」"
  },
  showWatchlist: {
    type: "boolean",
    default: true,
    desc: "扫描报告中是否输出【观察项】（命中未达阈值）"
  },
  disabledRules: {
    type: "array",
    default: [],
    desc: "要关闭的规则 id 列表（对应 rules.json 的单规则开关）"
  }
};

function issue(message, path) {
  return { message: message, path: path ? [path] : [] };
}

function validateConfig(input) {
  var value = {};
  var issues = [];
  var src = input === undefined || input === null ? {} : input;

  if (typeof src !== "object" || Array.isArray(src)) {
    return { issues: [issue("config 必须是对象")] };
  }

  for (var key in FIELDS) {
    var spec = FIELDS[key];
    var v = src[key];
    if (v === undefined || v === null) {
      value[key] = Array.isArray(spec.default) ? spec.default.slice() : spec.default;
      continue;
    }
    if (spec.type === "string") {
      if (typeof v !== "string") {
        issues.push(issue(key + " 必须是字符串", key));
        continue;
      }
      if (spec.enum && spec.enum.indexOf(v) < 0) {
        issues.push(issue(key + " 必须是 " + spec.enum.join("/") + " 之一", key));
        continue;
      }
      value[key] = v;
    } else if (spec.type === "number") {
      if (typeof v !== "number" || !isFinite(v)) {
        issues.push(issue(key + " 必须是数字", key));
        continue;
      }
      if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max)) {
        issues.push(issue(key + " 必须在 " + spec.min + "–" + spec.max + " 之间", key));
        continue;
      }
      value[key] = v;
    } else if (spec.type === "boolean") {
      if (typeof v !== "boolean") {
        issues.push(issue(key + " 必须是布尔值", key));
        continue;
      }
      value[key] = v;
    } else if (spec.type === "array") {
      if (!Array.isArray(v)) {
        issues.push(issue(key + " 必须是数组", key));
        continue;
      }
      var clean = [];
      for (var i = 0; i < v.length; i++) {
        if (typeof v[i] !== "string") {
          issues.push(issue(key + " 的元素必须是字符串", key));
          continue;
        }
        clean.push(v[i]);
      }
      value[key] = clean;
    }
  }

  // 未知键：忽略（宿主可能附加元数据），但保留无害
  return issues.length ? { issues: issues } : { value: value };
}

/** Standard Schema v1 对象（Cordis 识别这个接口） */
var ConfigSchema = {
  "~standard": {
    version: 1,
    vendor: "optimize-ai-reply",
    validate: function (value) {
      return validateConfig(value);
    }
  },
  // 附带友好描述，便于宿主展示
  description: FIELDS
};

module.exports = {
  ConfigSchema: ConfigSchema,
  validateConfig: validateConfig,
  FIELDS: FIELDS,
  REGISTERS: REGISTERS
};
