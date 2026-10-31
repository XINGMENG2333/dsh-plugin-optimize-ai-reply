/**
 * prepare-listing.mjs —— 上架前一键准备：替换 GitHub 占位符 + 重生成市场索引 + 跑契约测试
 * 用法：node scripts/prepare-listing.mjs --owner 你的GitHub账号
 * 之后按 market/LISTING-KIT.md 的三步执行即可完成 dsh-market + GitHub 上架。
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseArgs() {
  const argv = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--owner" && argv[i + 1]) out.owner = argv[++i];
  }
  return out;
}

const TARGETS = [
  "package.json",
  "README.md",
  "PROMPT.md",
  "market/README.md",
  "market/LISTING-KIT.md",
  "market/awesome-dsh-plugin.yml",
  "market/index.json",
  "market/plugins.txt",
  "scripts/build-market-index.mjs"
];

async function main() {
  const { owner } = parseArgs();
  if (!owner || !/^[\w.-]+$/.test(owner)) {
    console.error("用法：node scripts/prepare-listing.mjs --owner <你的 GitHub 账号/组织名>");
    process.exitCode = 1;
    return;
  }

  let changed = 0;
  for (const rel of TARGETS) {
    const file = path.join(ROOT, rel);
    let text;
    try {
      text = await fs.readFile(file, "utf8");
    } catch {
      continue;
    }
    const after = text
      .split("your-github-id").join(owner)
      .split("your-org").join(owner)
      .split("你的GitHub账号").join(owner);
    if (after !== text) {
      await fs.writeFile(file, after, "utf8");
      changed++;
      console.log("替换占位符:", rel);
    }
  }

  // 生成器里的 OWNER 常量也可能是占位符，重生成索引
  execFileSync(process.execPath, [path.join(ROOT, "scripts", "build-market-index.mjs")], {
    stdio: "inherit"
  });

  // 契约测试兜底
  execFileSync(process.execPath, [path.join(ROOT, "tests", "dsh-plugin.test.js")], {
    stdio: "inherit"
  });

  console.log("");
  console.log(`完成：${changed} 个文件已替换为 @${owner}，市场索引已重生成，契约测试通过。`);
  console.log("接下来按 market/LISTING-KIT.md 的三步执行（建仓推送 → awesome PR → 市场提交）。");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
