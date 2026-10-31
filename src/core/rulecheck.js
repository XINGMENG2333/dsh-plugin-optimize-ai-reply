/**
 * rulecheck.js —— 规则体检命令：跑内置人类语料（+可选 AI 语料），输出每条规则的误报率与建议。
 * 用法：
 *   node src/core/rulecheck.js            # 默认跑 src/corpus/ 的 40 段人类 + 20 段 AI
 *   node src/core/rulecheck.js --json     # JSON 输出
 * 规格：误报率 > 5% 不许合入规则改动。
 */
(function (root, factory) {
  var isNode = typeof module !== "undefined" && module.exports;
  var scanMod = isNode ? require("./scan.js") : root.DeaiScan;
  var api = factory(scanMod);
  if (isNode) {
    module.exports = api;
  }
  if (root) {
    root.DeaiRulecheck = api;
  }
})(typeof self !== "undefined" ? self : this, function (Scan) {
  "use strict";

  var KIND_REGISTER = {
    forum: "qa",
    techdoc: "popular",
    email: "formal",
    popsci: "popular"
  };

  /**
   * rulecheck(humanDocs, aiDocs, opts) -> { rules[], summary }
   * docs: [{ id, register?, model?, text }]
   */
  function rulecheck(humanDocs, aiDocs, opts) {
    opts = opts || {};
    var rules = opts.rules || Scan.getDefaultRules();
    var byRule = {};

    function visit(doc, isHuman) {
      var register = doc.register || KIND_REGISTER[doc.kind] || "qa";
      var model = doc.model || "unknown";
      var res = Scan.scan(doc.text, register, model, rules);
      for (var i = 0; i < res.stats.length; i++) {
        var st = res.stats[i];
        var k = st.id + (st.variantId ? "/" + st.variantId : "");
        if (!byRule[k]) {
          byRule[k] = { id: st.id, variantId: st.variantId, name: st.name, group: st.group, humanDocs: 0, humanHits: 0, humanFlagged: 0, aiDocs: 0, aiHits: 0, aiFlagged: 0, asOf: null, stale: st.stale };
        }
        if (isHuman) {
          byRule[k].humanHits += st.hits;
          if (st.level === "elevated" || st.level === "high") {
            byRule[k].humanFlagged++;
          }
        } else {
          byRule[k].aiHits += st.hits;
          if (st.level === "elevated" || st.level === "high") {
            byRule[k].aiFlagged++;
          }
        }
      }
    }

    var hi;
    for (hi = 0; hi < humanDocs.length; hi++) {
      visit(humanDocs[hi], true);
    }
    for (var ai = 0; ai < (aiDocs || []).length; ai++) {
      visit(aiDocs[ai], false);
    }

    var rows = [];
    for (var k in byRule) {
      var r = byRule[k];
      var fpRate = humanDocs.length ? r.humanFlagged / humanDocs.length : 0;
      var detRate = aiDocs && aiDocs.length ? r.aiFlagged / aiDocs.length : 0;
      var suggestion;
      if (fpRate > 0.05) {
        suggestion = "⚠ 误报率 " + (fpRate * 100).toFixed(1) + "% 超过 5%：提高最小样本、加保留边界或降观察项";
      } else if (aiDocs && aiDocs.length && detRate === 0 && r.aiHits === 0) {
        suggestion = "AI 语料零命中：核对规则时效与词表（as_of），或该特征已过时";
      } else if (fpRate === 0 && detRate > 0.3) {
        suggestion = "健康：零误报且检出 " + (detRate * 100).toFixed(0) + "%";
      } else {
        suggestion = "正常（误报 " + (fpRate * 100).toFixed(1) + "%）";
      }
      rows.push({
        id: r.id,
        variantId: r.variantId,
        name: r.name,
        group: r.group,
        humanFlagged: r.humanFlagged,
        humanDocs: humanDocs.length,
        fpRate: Math.round(fpRate * 1000) / 1000,
        humanHits: r.humanHits,
        aiFlagged: r.aiFlagged,
        aiDocs: aiDocs ? aiDocs.length : 0,
        detectionRate: Math.round(detRate * 1000) / 1000,
        aiHits: r.aiHits,
        suggestion: suggestion
      });
    }
    rows.sort(function (a, b) {
      return b.fpRate - a.fpRate || a.id.localeCompare(b.id);
    });

    var totalFP = 0;
    for (hi = 0; hi < humanDocs.length; hi++) {
      var resH = Scan.scan(humanDocs[hi].text, humanDocs[hi].register || KIND_REGISTER[humanDocs[hi].kind] || "qa", humanDocs[hi].model || "unknown", rules);
      if (Scan.documentFlag(resH).flagged) totalFP++;
    }

    return {
      rules: rows,
      summary: {
        humanDocs: humanDocs.length,
        aiDocs: aiDocs ? aiDocs.length : 0,
        humanFlaggedDocs: totalFP,
        docFpRate: humanDocs.length ? Math.round((totalFP / humanDocs.length) * 1000) / 1000 : 0
      }
    };
  }

  return { rulecheck: rulecheck, KIND_REGISTER: KIND_REGISTER };
});

// ---------- CLI ----------
if (typeof require !== "undefined" && typeof module !== "undefined" && require.main === module) {
  var fs = require("fs");
  var path = require("path");
  var ScanCli = require("./scan.js");
  var RulecheckCli = module.exports;

  function loadCorpus(file) {
    var p = path.join(__dirname, "..", "corpus", file);
    return JSON.parse(fs.readFileSync(p, "utf8"));
  }

  var humanZh = loadCorpus("human-zh.json");
  var humanEn = loadCorpus("human-en.json");
  var aiZh = loadCorpus("ai-zh.json");
  var aiEn = loadCorpus("ai-en.json");

  var human = humanZh.concat(humanEn);
  var ai = aiZh.concat(aiEn);
  // 语种登记：英文语料扫英文规则
  for (var i = 0; i < human.length; i++) {
    human[i].register = human[i].register || RulecheckCli.KIND_REGISTER[human[i].kind] || "qa";
    human[i].model = human[i].model || "unknown";
  }
  for (var j = 0; j < ai.length; j++) {
    ai[j].register = ai[j].register || "qa";
    ai[j].model = ai[j].model || "unknown";
  }

  var report = RulecheckCli.rulecheck(human, ai, { rules: ScanCli.getDefaultRules() });

  if (process.argv.indexOf("--json") >= 0) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log("# rulecheck —— 规则体检（内置回归语料）");
    console.log("人类文档 " + report.summary.humanDocs + " 段｜被判偏高 " + report.summary.humanFlaggedDocs + " 段｜文档误报率 " + (report.summary.docFpRate * 100).toFixed(1) + "%（要求 ≤5%）");
    console.log("");
    console.log("规则".padEnd(22) + "误报文档".padEnd(10) + "误报率".padEnd(8) + "AI命中".padEnd(8) + "建议");
    for (var r = 0; r < report.rules.length; r++) {
      var row = report.rules[r];
      if (row.humanFlagged === 0 && row.aiFlagged === 0) continue;
      console.log(
        (row.id + (row.variantId ? "/" + row.variantId : "")).padEnd(22) +
        String(row.humanFlagged + "/" + row.humanDocs).padEnd(10) +
        (row.fpRate * 100).toFixed(1).padEnd(8) +
        String(row.aiFlagged + "/" + row.aiDocs).padEnd(8) +
        row.suggestion
      );
    }
  }
}
