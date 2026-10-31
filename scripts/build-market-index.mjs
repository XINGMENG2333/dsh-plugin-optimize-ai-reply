/**
 * build-market-index.mjs —— 生成 market/index.json（DSH 插件市场 format 1 索引）
 * 规范：https://deepseek-harness.github.io/deepseek-harness/en/guide/plugin-market
 * 用法：node scripts/build-market-index.mjs
 * 图标内联为 data: URL（≤32 KiB），索引单文件即可托管（GitHub Pages / 任意静态源）。
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OWNER_PLACEHOLDER = "your-github-id"; // 发布前替换为真实 GitHub 账号/组织

async function main() {
  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  const iconBytes = await fs.readFile(path.join(ROOT, "assets", "icons", "icon128.png"));
  const iconDataUrl = `data:image/png;base64,${iconBytes.toString("base64")}`;
  if (iconDataUrl.length > 32 * 1024) {
    throw new Error("图标 data: URL 超过 32 KiB，改用相对文件引用");
  }

  const repoUrl = `https://github.com/${OWNER_PLACEHOLDER}/dsh-plugin-optimize-ai-reply`;
  const publishTimestamp = Math.floor(Date.parse("2026-10-31T12:45:00+08:00") / 1000);

  const index = {
    format: 1,
    title: { en: "Optimize AI Reply plugin source", zh: "优化 AI 回复插件源" },
    description: {
      en: "Market index for dsh-plugin-optimize-ai-reply: local density scanner, five-layer verification, closed-loop rescan.",
      zh: "dsh-plugin-optimize-ai-reply 的市场索引：本地密度扫描、五层校验、闭环复扫。"
    },
    metadata: {
      categories: {
        writing: { title: { en: "Writing", zh: "写作" } },
        tools: { title: { en: "Tools", zh: "工具" } }
      },
      labels: {
        "local-first": { title: { en: "Local-first", zh: "本地优先" } },
        bilingual: { title: { en: "Bilingual", zh: "中英双语" } },
        "zero-network": { title: { en: "Zero-network scan", zh: "扫描零网络" } }
      },
      sortKeys: {
        publishDate: { title: { en: "Publish date", zh: "发布日期" }, order: "desc" }
      }
    },
    plugins: [
      {
        name: pkg.name,
        title: { en: "Optimize AI Reply", zh: "优化 AI 回复" },
        description: {
          en: "Strips AI-flavor from LLM text: local density scanner with human baselines, five-layer fact/strength/safety verification, closed-loop rescan, and a54-rule regression corpus. Facts, hedging strength, and safety notes are never lost.",
          zh: "把大模型输出改成读起来像人写的：人类基线密度扫描、五层校验（事实/强度/安全/结构）、闭环复扫、54 条规则回归语料。事实、论断强度、安全信息零损失。"
        },
        icon: iconDataUrl,
        author: "Optimize AI Reply contributors",
        homepage: `${repoUrl}#readme`,
        repository: { url: repoUrl },
        metadata: {
          category: "writing",
          labels: ["local-first", "bilingual", "zero-network"]
        },
        versions: [
          {
            version: pkg.version,
            publishTimestamp,
            source: { type: "npm" },
            engines: { dsh: pkg.engines.dsh }
          }
        ]
      }
    ]
  };

  const outDir = path.join(ROOT, "market");
  await fs.mkdir(outDir, { recursive: true });
  const outFile = path.join(outDir, "index.json");
  await fs.writeFile(outFile, JSON.stringify(index, null, 2) + "\n", "utf8");
  console.log("generated:", outFile, `(v${pkg.version}, icon ${iconDataUrl.length} bytes)`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
