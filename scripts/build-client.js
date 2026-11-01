/**
 * build-client.js —— 产出 DSH 客户端半侧 lib/client.js
 * 源码 src/client/index.js 已是最终的懒加载 CJS 工厂格式，原样拷贝。
 */
"use strict";

var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "..");
var from = path.join(root, "src", "client", "index.js");
var to = path.join(root, "lib", "client.js");

fs.mkdirSync(path.join(root, "lib"), { recursive: true });
fs.copyFileSync(from, to);
console.log("built lib/client.js");
