/**
 * index.js —— dsh-plugin-deai-tone 插件入口（CommonJS，兼容 require 与 import）
 * DeepSeek Harness 插件：Cordis 模块，导出 name / inject / Config / apply。
 * apply 里把「去 AI 味」L0–L6 流水线注册为 7 个 harness 工具（见 src/dsh/tools.js）。
 */
"use strict";

var schema = require("./src/dsh/schema.js");
var tools = require("./src/dsh/tools.js");

var name = "deai-tone";
var inject = ["tools"];
var Config = schema.ConfigSchema;

/**
 * @param {import('@deepseek-ai/cordis').Context} ctx
 * @param {object} config 已通过 Config schema 校验的配置
 */
function apply(ctx, config) {
  var cfg = config || schema.validateConfig(undefined).value;
  var defs = tools.buildTools(cfg);
  for (var i = 0; i < defs.length; i++) {
    ctx.tools.register(defs[i]);
  }
  if (ctx.logger && typeof ctx.logger.info === "function") {
    ctx.logger.info("[deai-tone] registered tools: " + tools.TOOL_NAMES.join(", "));
  }
}

// 显式具名导出（CJS 命名导出检测 100% 可靠）+ 默认导出（对象形态，兼容不同加载器）
exports.name = name;
exports.inject = inject;
exports.Config = Config;
exports.apply = apply;
exports.default = {
  name: name,
  inject: inject,
  Config: Config,
  apply: apply
};
