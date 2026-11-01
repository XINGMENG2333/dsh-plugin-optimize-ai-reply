/**
 * rescan.js —— L5 闭环复扫（纯函数、可单测）
 * 改写结果重新扫描：①被处理项密度必须下降；②不得引入新的「偏高/高」项。
 * 不满足 → 上层回退原文。把破折号换成「说白了」就是引入了新特征，会被 ② 拦下。
 */
(function (root, factory) {
  var scanMod =
    (typeof module !== "undefined" && module.exports)
      ? require("./scan.js")
      : root.DeaiScan;
  var api = factory(scanMod);
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  if (root) {
    root.DeaiRescan = api;
  }
})(typeof self !== "undefined" ? self : this, function (Scan) {
  "use strict";

  function key(stat) {
    return stat.id + "/" + (stat.variantId || "");
  }

  /**
   * rescan(beforeText, afterText, scanBefore, opts) -> { ok, reason, resolved[], newElevated[], scanAfter }
   * opts: { register, model, rules }
   */
  function rescan(beforeText, afterText, scanBefore, opts) {
    opts = opts || {};
    var scanAfter = Scan.scan(afterText, opts.register || "qa", opts.model || "unknown", opts.rules);

    var beforeByKey = {};
    var afterByKey = {};
    var i;
    for (i = 0; i < scanBefore.stats.length; i++) beforeByKey[key(scanBefore.stats[i])] = scanBefore.stats[i];
    for (i = 0; i < scanAfter.stats.length; i++) afterByKey[key(scanAfter.stats[i])] = scanAfter.stats[i];

    // ① 被处理项（原 偏高/高）密度必须下降
    var resolved = [];
    var notImproved = [];
    for (var bk in beforeByKey) {
      var b = beforeByKey[bk];
      if (b.level !== "elevated" && b.level !== "high") continue;
      var a = afterByKey[bk];
      var afterDensity = a ? a.density : 0;
      var afterHits = a ? a.hits : 0;
      if (afterHits === 0 || afterDensity < b.density) {
        resolved.push({ key: bk, before: b.density, after: afterDensity });
      } else {
        notImproved.push({ key: bk, name: b.name, before: b.density, after: afterDensity });
      }
    }

    // ② 不得引入新的偏高/高（原 正常/观察 项升上来即失败）
    var newElevated = [];
    for (var ak in afterByKey) {
      var aft = afterByKey[ak];
      if (aft.level !== "elevated" && aft.level !== "high") continue;
      var bef = beforeByKey[ak];
      if (!bef || (bef.level !== "elevated" && bef.level !== "high")) {
        newElevated.push({ key: ak, name: aft.name, hits: aft.hits, density: aft.density });
      }
    }

    var ok = notImproved.length === 0 && newElevated.length === 0;
    var reason = "";
    if (!ok) {
      var parts = [];
      if (notImproved.length) {
        parts.push("被处理项密度未下降：" + notImproved.map(function (x) { return x.name + "(" + x.before + "→" + x.after + ")"; }).join("、"));
      }
      if (newElevated.length) {
        parts.push("引入新的偏高项：" + newElevated.map(function (x) { return x.name; }).join("、"));
      }
      reason = parts.join("；");
    }

    return { ok: ok, reason: reason, resolved: resolved, notImproved: notImproved, newElevated: newElevated, scanAfter: scanAfter };
  }

  return { rescan: rescan, key: key };
});
