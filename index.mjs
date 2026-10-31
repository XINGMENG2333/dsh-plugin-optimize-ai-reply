/**
 * index.mjs —— ESM 入口包装（import() 场景的具名导出保证）
 * 实现在 index.js（CommonJS，与测试套件共享）。
 */
import plugin from "./index.js";

export const name = plugin.name;
export const inject = plugin.inject;
export const Config = plugin.Config;
export const apply = plugin.apply;
export default plugin.default;
