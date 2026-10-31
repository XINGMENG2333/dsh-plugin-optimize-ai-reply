/**
 * src/client/index.js —— 「优化 AI 回复」客户端半侧（DSH Web 界面开关页）
 *
 * 产物即此文件原样拷贝为 lib/client.js（懒加载 CJS 工厂格式，DSH 客户端模块
 * 系统约定：`window.__ModuleLoader__.load({ id, factory })`，factory 内的
 * `require` 只能请求平台共享模块表中的基座模块）。
 *
 * 功能：在 DSH 侧栏「插件」页为本组合包注册配置区（`plugins.bundle.config`）
 * 与行配置区（`plugins.row.config`），渲染「启用优化」总开关。开关的值经
 * `ctx.configForms`（settings 服务）落到当前 profile 的 cordis.patch.yml 并
 * 即时生效——宿主半侧的工具每次调用时实时读取该值，关闭后立即暂停工作。
 */
window.__ModuleLoader__.load({
	id: "dsh-plugin-optimize-ai-reply",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		// ---------- 基座模块（平台共享模块表） ----------
		var react = require("react");
		var jsxRuntime = require("react/jsx-runtime");
		var primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		var jsx = jsxRuntime.jsx;
		var jsxs = jsxRuntime.jsxs;

		// ---------- 标识 ----------

		/** 本插件字典命名空间。 */
		var NS = "optimize-ai-reply.config";
		/** 插件配置项（Loader 条目 id，settings 命名空间同名）。 */
		var ENTRY_ID = "optimize-ai-reply";
		/** 组合包名（bundle 契约与 slot 键）。 */
		var BUNDLE = "dsh-plugin-optimize-ai-reply";
		/** 行配置 slot 键：`<组合包名>#<行 id>`。 */
		var ROW_KEY = BUNDLE + "#" + ENTRY_ID;

		// ---------- 文案 ----------

		var zh = {
			title: "优化 AI 回复",
			summary: "总开关：关闭后全部工具暂停工作。",
			description: "关闭后，扫描、改写任务书、校验、复扫等全部工具立即暂停工作，回复不再经过「去 AI 味」流水线；随时可以再打开。",
			switchLabel: "启用优化",
			statusOn: "优化已启用：工具正常工作。",
			statusOff: "优化已关闭：全部工具暂停工作。",
			unavailable: "该插件当前未加载，暂时无法配置。",
			saveFailed: "保存失败，开关保持原值，请重试。"
		};

		var en = {
			title: "Optimize AI Reply",
			summary: "Master switch: all tools pause while it is off.",
			description: "When off, every tool — scanning, rewrite brief, verification, rescan — pauses immediately and replies skip the pipeline. Turn it back on any time.",
			switchLabel: "Enable optimization",
			statusOn: "Optimization is on: tools are working.",
			statusOff: "Optimization is off: all tools are paused.",
			unavailable: "This plugin is not loaded, so it cannot be configured right now.",
			saveFailed: "The change was not saved; the switch kept its previous value. Please retry."
		};

		// ---------- 样式（与 DSH 设计令牌对齐的极简行布局） ----------

		var CSS = [
			".oar_row{border-bottom:.5px solid var(--dsw-alias-border-l2);justify-content:space-between;align-items:center;gap:24px;padding:16px 0;display:flex}",
			".oar_main{min-width:0}",
			".oar_title{color:var(--dsw-alias-label-primary);font-size:14px;line-height:20px}",
			".oar_description{color:var(--dsw-alias-label-secondary);margin-top:4px;font-size:12px;line-height:18px}",
			".oar_status{color:var(--dsw-alias-label-tertiary);margin-top:6px;font-size:12px;line-height:18px}",
			".oar_error{color:var(--dsw-alias-state-error-primary);margin-top:6px;font-size:12px;line-height:18px}"
		].join("");

		var TAG_ID = BUNDLE + "/switch.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG_ID) + "]") === null) {
			var tag = document.createElement("style");
			tag.dataset.plugin = BUNDLE;
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		var CLS = { row: "oar_row", main: "oar_main", title: "oar_title", description: "oar_description", status: "oar_status", error: "oar_error" };

		// ---------- 开关卡片 ----------

		/** 订阅配置命名空间快照的 React hook。 */
		function useScopeSnapshot(scope) {
			var state = react.useState(function () {
				return scope.getSnapshot();
			});
			var snap = state[0];
			var setSnap = state[1];
			react.useEffect(function () {
				return scope.subscribe(function () {
					setSnap(scope.getSnapshot());
				});
			}, []);
			return snap;
		}

		/**
		 * 构造开关卡片组件（闭包持有 settings 命名空间控制器）。
		 * @param {{getSnapshot: Function, subscribe: Function, set: Function}} scope configForms 控制器
		 * @returns 注册进 slot 的渲染组件
		 */
		function makeToggleCard(scope) {
			return function ToggleCard(props) {
				var t = props.t;
				var snap = useScopeSnapshot(scope);
				var busyState = react.useState(false);
				var busy = busyState[0];
				var setBusy = busyState[1];
				var failState = react.useState(false);
				var failed = failState[0];
				var setFailed = failState[1];

				if (props.view === "summary") return t("summary");

				var ready = snap.status === "ready";
				var enabled = ready && snap.value && snap.value.enabled !== false;
				var statusText = !ready ? t("unavailable") : enabled ? t("statusOn") : t("statusOff");

				return jsxs("div", {
					className: CLS.row,
					children: [
						jsxs("div", {
							className: CLS.main,
							children: [
								jsx("div", { className: CLS.title, children: t("title") }),
								jsx("div", { className: CLS.description, children: t("description") }),
								jsx("div", { className: CLS.status, children: statusText }),
								failed ? jsx("div", { className: CLS.error, role: "alert", children: t("saveFailed") }) : null
							]
						}),
						jsx(primitives.Switch, {
							checked: !!enabled,
							disabled: busy || !ready || !snap.writable,
							label: t("switchLabel"),
							onChange: function (next) {
								setFailed(false);
								setBusy(true);
								Promise.resolve()
									.then(function () {
										return scope.set("enabled", !!next);
									})
									.then(function (ok) {
										if (!ok) setFailed(true);
									})
									["catch"](function () {
										setFailed(true);
									})
									["finally"](function () {
										setBusy(false);
									});
							}
						})
					]
				});
			};
		}

		// ---------- 插件入口（浏览器半侧） ----------

		/** 必需服务（cordis fiber inject）。 */
		var inject = ["slots", "locale", "configForms"];

		/**
		 * 注册界面开关页。
		 * @param {object} ctx 浏览器插件上下文
		 */
		function apply(ctx) {
			var t = ctx.locale.bind(NS);
			ctx.effect(function () {
				return ctx.locale.register(NS, { zh: zh, en: en });
			}, "optimize-ai-reply: dictionaries");

			var scope = ctx.configForms.get(ENTRY_ID);
			var ToggleCard = makeToggleCard(scope);

			ctx.effect(function () {
				return ctx.slots.inject("plugins.bundle.config", function () {
					return ctx.slots.register({ name: "plugins.bundle.config", key: BUNDLE, locale: NS }, ToggleCard);
				});
			}, "optimize-ai-reply: bundle config page");

			ctx.effect(function () {
				return ctx.slots.inject("plugins.row.config", function () {
					return ctx.slots.register({ name: "plugins.row.config", key: ROW_KEY, locale: NS }, ToggleCard);
				});
			}, "optimize-ai-reply: row config page");

			if (ctx.logger && typeof ctx.logger.info === "function") {
				ctx.logger.info("[optimize-ai-reply] switch page registered");
			}
		}

		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
