/**
 * _gh.js —— GitHub REST 助手（一次性上架用；token 从 %TEMP%/.gh-cred.json 读取）
 * 走 curl.exe（系统代理感知）；报错脱敏（绝不回显 Authorization）。
 * 用法：node scripts/_gh.js <METHOD> <path无斜杠> [--body '<json>'] [--raw] [--out <file>]
 */
"use strict";
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

function cred() {
  const p = path.join(os.tmpdir(), ".gh-cred.json");
  if (!fs.existsSync(p)) {
    console.error("缺少凭据文件");
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function main() {
  const [method, apiPathRaw, ...rest] = process.argv.slice(2);
  if (!method || !apiPathRaw) {
    console.error("用法：node scripts/_gh.js <METHOD> <path无斜杠> [--body '<json>'] [--raw] [--out <file>]");
    process.exit(1);
  }
  const apiPath = apiPathRaw.startsWith("/") ? apiPathRaw : "/" + apiPathRaw;
  let body;
  const bodyIdx = rest.indexOf("--body");
  if (bodyIdx >= 0 && rest[bodyIdx + 1]) body = rest[bodyIdx + 1];
  const raw = rest.includes("--raw");
  const outIdx = rest.indexOf("--out");
  const outFile = outIdx >= 0 ? rest[outIdx + 1] : null;

  const c = cred();
  const args = [
    "-sS", "-X", method,
    "-H", "Authorization: Bearer " + c.password,
    "-H", "Accept: application/vnd.github+json",
    "-H", "X-GitHub-Api-Version: 2022-11-28",
    "-H", "User-Agent: optimize-ai-reply-listing",
    "-w", "\n__HTTP__%{http_code}"
  ];
  if (body) {
    const bodyFile = path.join(os.tmpdir(), ".gh-body.json");
    fs.writeFileSync(bodyFile, body, "utf8");
    args.push("-H", "Content-Type: application/json", "--data-binary", "@" + bodyFile);
  }
  if (outFile) args.push("-o", outFile);
  args.push("https://api.github.com" + apiPath);

  const r = spawnSync("curl.exe", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, shell: false });
  const out = (r.stdout || "") + "";
  const idx = out.lastIndexOf("__HTTP__");
  const status = idx >= 0 ? out.slice(idx + 8).trim() : "?";
  const bodyText = idx >= 0 ? out.slice(0, idx) : out;
  if (r.status !== 0 && status === "?") {
    console.error("curl 失败（脱敏）：" + (r.stderr || "").replace(/Bearer\s+\S+/g, "Bearer <hidden>"));
    process.exit(1);
  }
  if (outFile) {
    console.log("HTTP " + status + " -> " + outFile);
  } else if (raw) {
    console.log(bodyText.slice(0, 2000));
  } else {
    try {
      console.log(JSON.stringify(JSON.parse(bodyText), null, 2).slice(0, 3000));
    } catch {
      console.log(bodyText.slice(0, 800));
    }
  }
  if (!["200", "201", "202", "204"].includes(status)) {
    console.error("HTTP " + status);
    process.exit(2);
  }
}

main();
