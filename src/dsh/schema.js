/**
 * schema.js —— 插件配置 schema（零依赖，schemastery 兼容）
 *
 * 双重身份：
 *   1. Standard Schema v1（`~standard.validate`）—— Cordis/Loader 用它校验并解析配置；
 *   2. schemastery 结构兼容节点（`~standard.vendor === "schemastery"`，`type/dict/meta/toJSON`）
 *      —— DSH 的 Loader 与 dsh-settings 服务借此识别「即时（volatile）配置字段」，
 *      把它们投影成 DSH 界面上的可编辑表单（开关就在这里）。
 *
 * volatile 字段（本插件为 `enabled` 总开关）解析后是 cosmokit 兼容的稳定引用：
 *   `ref.get()` 读当前值；Loader 在用户于界面改开关后，用同一协议把新值写回
 *   正在运行的引用（无需重启、无需重载插件）。协议标识为
 *   `Symbol.for("cosmokit.volatile.write")`，与宿主的 cosmokit 跨副本互认。
 */
"use strict";

// ---------- cosmokit 兼容的 volatile 引用 ----------

var VOLATILE_WRITE = Symbol.for("cosmokit.volatile.write");

/** 创建稳定引用：持有不可变快照，只由宿主 Loader 通过共享协议写入。 */
function makeVolatile(value) {
  var current = value;
  var ref = {
    get: function () {
      return current;
    }
  };
  Object.defineProperty(ref, VOLATILE_WRITE, {
    value: function (next) {
      current = next;
    }
  });
  return Object.freeze(ref);
}

/** 与 cosmokit 的 isVolatile 同判定：带共享写符号的引用对象。 */
function isVolatileRef(value) {
  return typeof value === "object" && value !== null && VOLATILE_WRITE in value;
}

/** 读出配置值：引用取 `get()`，普通值原样返回（兼容无 Loader 的离线场景）。 */
function unwrap(value) {
  return isVolatileRef(value) ? value.get() : value;
}

// ---------- schemastery 兼容的 schema 节点 ----------

// 节点 uid 在创建时固定（同 schemastery：构造期分配、序列化期复用），
// 保证 settings 服务每次 describe 的修订号比较稳定。
var uidSeq = 1;

/**
 * 造一个 schemastery 结构兼容节点。
 * @param {string} type object|boolean|string|number|array
 * @param {{meta?: object, dict?: object, inner?: object, list?: array}} props
 */
function makeNode(type, props) {
  props = props || {};
  var node = { type: type, meta: props.meta || {} };
  if (props.dict) node.dict = props.dict;
  if (props.inner) node.inner = props.inner;
  if (props.list) node.list = props.list;
  Object.defineProperty(node, "uid", { value: uidSeq++ });
  Object.defineProperty(node, "toJSON", {
    value: function () {
      return serializeFrom(node);
    }
  });
  return node;
}

/**
 * 序列化为 schemastery 的 `{uid, refs}` 图形信封：
 * refs 表按 uid 索引节点的 JSON 拷贝，嵌套节点以 uid 数字引用；
 * `new z(该信封)`（真实 schemastery）可完整重建。meta 深拷贝，
 * 防止消费方（如表单投影）就地删除 volatile 标记时污染本 schema。
 */
function serializeFrom(root) {
  var refs = {};
  function visit(node) {
    if (Object.prototype.hasOwnProperty.call(refs, node.uid)) return node.uid;
    var entry = { type: node.type, meta: JSON.parse(JSON.stringify(node.meta)) };
    refs[node.uid] = entry;
    if (node.dict) {
      entry.dict = {};
      var keys = Object.keys(node.dict);
      for (var i = 0; i < keys.length; i++) entry.dict[keys[i]] = visit(node.dict[keys[i]]);
    }
    if (node.inner) entry.inner = visit(node.inner);
    if (node.list) entry.list = node.list.map(visit);
    return node.uid;
  }
  return { uid: visit(root), refs: refs };
}

// ---------- 字段定义 ----------

var REGISTERS = ["qa", "social", "script", "popular", "formal", "academic"];

var FIELDS = {
  enabled: {
    type: "boolean",
    default: true,
    volatile: true,
    desc: "总开关：关闭后全部工具暂停工作（在 DSH 界面「插件 → 优化 AI 回复 → 配置」切换，即时生效）"
  },
  defaultRegister: {
    type: "string",
    enum: REGISTERS,
    default: "qa",
    desc: "默认文体档位（问答对话/社媒/口播台词/科普长文/正式文书/学术）"
  },
  rewriteStrength: {
    type: "string",
    enum: ["safe", "strong", "max"],
    default: "max",
    desc: "改写强度：safe 只动命中句｜strong 重构命中段落｜max 整段语言逻辑重写（默认）"
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

function fieldNode(spec) {
  var meta = { default: Array.isArray(spec.default) ? spec.default.slice() : spec.default };
  if (spec.volatile) meta.volatile = true;
  meta.description = spec.desc;
  var node = makeNode(spec.type, { meta: meta });
  if (spec.type === "array") node.inner = makeNode("string", { meta: {} });
  return node;
}

function buildRoot() {
  var dict = {};
  for (var key in FIELDS) dict[key] = fieldNode(FIELDS[key]);
  return makeNode("object", { meta: {}, dict: dict });
}

var ROOT = buildRoot();

// ---------- 校验（Standard Schema v1 的 validate） ----------

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
    if (isVolatileRef(v)) v = v.get();
    if (v === undefined || v === null) {
      v = Array.isArray(spec.default) ? spec.default.slice() : spec.default;
    } else if (spec.type === "string") {
      if (typeof v !== "string") {
        issues.push(issue(key + " 必须是字符串", key));
        continue;
      }
      if (spec.enum && spec.enum.indexOf(v) < 0) {
        issues.push(issue(key + " 必须是 " + spec.enum.join("/") + " 之一", key));
        continue;
      }
    } else if (spec.type === "number") {
      if (typeof v !== "number" || !isFinite(v)) {
        issues.push(issue(key + " 必须是数字", key));
        continue;
      }
      if ((spec.min !== undefined && v < spec.min) || (spec.max !== undefined && v > spec.max)) {
        issues.push(issue(key + " 必须在 " + spec.min + "–" + spec.max + " 之间", key));
        continue;
      }
    } else if (spec.type === "boolean") {
      if (typeof v !== "boolean") {
        issues.push(issue(key + " 必须是布尔值", key));
        continue;
      }
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
      v = clean;
    }
    // volatile 字段以稳定引用交付：宿主 Loader 可在插件运行中热更新其值
    value[key] = spec.volatile ? makeVolatile(v) : v;
  }

  // 未知键：忽略（宿主可能附加元数据），但保留无害
  return issues.length ? { issues: issues } : { value: value };
}

/** Standard Schema v1 对象（Cordis 识别这个接口）；结构面供 Loader/settings 读取。 */
var ConfigSchema = ROOT;
Object.defineProperty(ConfigSchema, "~standard", {
  value: {
    version: 1,
    vendor: "schemastery",
    validate: function (value) {
      return validateConfig(value);
    }
  }
});
// 附带友好描述，便于宿主展示
Object.defineProperty(ConfigSchema, "description", { value: FIELDS });

module.exports = {
  ConfigSchema: ConfigSchema,
  validateConfig: validateConfig,
  FIELDS: FIELDS,
  REGISTERS: REGISTERS,
  makeVolatile: makeVolatile,
  isVolatileRef: isVolatileRef,
  unwrap: unwrap
};
