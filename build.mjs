/**
 * build.mjs —— 构建脚本：装配 dist/ 并打包 zip（零第三方依赖）
 * 用法：node build.mjs
 * 产物：optimize-ai-reply/dist/（可直接「加载已解压的扩展程序」）与 optimize-ai-reply-vX.Y.Z.zip（商店上传用）
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execFileSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const DIST = path.join(ROOT, "dist");

// 扩展运行所需清单（测试/开发文件不进包）
const INCLUDE = [
  "manifest.json",
  "README.md",
  "LICENSE",
  "src",
  "assets",
  "demo"
];

async function copyTree(from, to) {
  const stat = await fs.stat(from);
  if (stat.isDirectory()) {
    await fs.mkdir(to, { recursive: true });
    for (const entry of await fs.readdir(from)) {
      await copyTree(path.join(from, entry), path.join(to, entry));
    }
  } else {
    await fs.copyFile(from, to);
  }
}

async function main() {
  // DSH 客户端半侧：懒加载 CJS 工厂格式产物（源码已是最终格式，原样拷贝）
  await fs.mkdir(path.join(ROOT, "lib"), { recursive: true });
  await fs.copyFile(path.join(ROOT, "src", "client", "index.js"), path.join(ROOT, "lib", "client.js"));

  await fs.rm(DIST, { recursive: true, force: true });
  await fs.mkdir(DIST, { recursive: true });
  for (const item of INCLUDE) {
    const src = path.join(ROOT, item);
    try {
      await copyTree(src, path.join(DIST, item));
    } catch (err) {
      if (err.code === "ENOENT") {
        console.log("跳过（不存在）：" + item);
      } else {
        throw err;
      }
    }
  }

  const pkg = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8"));
  const zipName = `optimize-ai-reply-v${pkg.version}.zip`;
  const zipPath = path.join(ROOT, zipName);
  await fs.rm(zipPath, { force: true });

  if (process.platform === "win32") {
    // Windows：PowerShell Compress-Archive
    execFileSync(
      "powershell",
      ["-NoProfile", "-Command", `Compress-Archive -Path '${DIST}\\*' -DestinationPath '${zipPath}' -Force`],
      { stdio: "inherit" }
    );
  } else {
    execFileSync("zip", ["-r", zipPath, "."], { cwd: DIST, stdio: "inherit" });
  }

  console.log("");
  console.log("构建完成：");
  console.log("  DSH 客户端半侧：lib/client.js");
  console.log("  目录：" + DIST);
  console.log("  压缩包：" + zipPath);
  console.log("安装：Chrome → 扩展程序 → 开发者模式 → 加载已解压的扩展程序 → 选 dist/");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
