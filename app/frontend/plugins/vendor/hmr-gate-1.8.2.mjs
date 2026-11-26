/*
 * Vendored from vite-plugin-hmr-gate 1.8.2 (dist/index.js) with local patches;
 * see README.md in this directory.
 *
 * MIT License
 *
 * Portions copyright (c) the original vite-plugin-hmr-gate authors
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
import { readFileSync } from "node:fs";
import { createHash, timingSafeEqual } from "node:crypto";
const statusCorsOriginRe = /^(?:https?:\/\/(?:(?:[^/:]+\.)?localhost|127\.0\.0\.1|\[::1\]))(?::\d+)?$/;
function requestPathname(req) {
	const url = req.url ?? "";
	const queryStart = url.indexOf("?");
	return queryStart === -1 ? url : url.slice(0, queryStart);
}
const nonNavigationPrefixes = [
	"/@vite/",
	"/@fs/",
	"/@id/",
	"/@react-refresh",
	"/api/",
	"/go-api/",
	"/assets/",
	"/src/",
	"/_",
	"/favicon"
];
function isHtmlNavigationRequest(req) {
	if (req.method !== "GET") return false;
	const url = req.url;
	if (!url || nonNavigationPrefixes.some((prefix) => url.startsWith(prefix))) return false;
	return (req.headers.accept ?? "").includes("text/html");
}
function gateStatusHeaders(req) {
	const origin = req.headers.origin;
	const headers = {
		"Content-Type": "application/json",
		Vary: "Origin"
	};
	if (typeof origin === "string" && statusCorsOriginRe.test(origin)) headers["Access-Control-Allow-Origin"] = origin;
	return headers;
}
// Local patch: the dev server listens on 0.0.0.0 and the Origin check skips requests
// without an Origin header, so when a token is configured the gate endpoints require it.
const GATE_TOKEN_HEADER = "x-mgx-hmr-token";
function gateTokenAccepted(req, token) {
	if (!token) return true;
	const given = req.headers[GATE_TOKEN_HEADER];
	if (typeof given !== "string") return false;
	const expected = Buffer.from(token);
	const actual = Buffer.from(given);
	return actual.length === expected.length && timingSafeEqual(actual, expected);
}
function rejectGateToken(res) {
	res.writeHead(401, { "Content-Type": "application/json" });
	res.end(JSON.stringify({ error: "invalid gate token" }));
}
const DEV_SERVER_MODE_EVENT = "mgx:dev-server-mode";
const BOOT_PROGRESS_EVENT = "mgx:boot-progress";
const BOOT_PROGRESS_MIN_INTERVAL_MS = 500;
const UPDATE_PROGRESS_EVENT = "mgx:update-progress";
const UPDATE_PROGRESS_MIN_INTERVAL_MS = 500;
const UPDATE_SETTLE_MS = 800;
const UPDATE_FLUSH_SETTLE_MS = 5e3;
const UPDATE_MIN_MODULES = 10;
const UPDATE_MIN_DURATION_MS = 1500;
function firstBuildError(error) {
	if (error == null || typeof error !== "object") return null;
	const errors = error.errors;
	const e = Array.isArray(errors) && errors.length > 0 ? errors[0] : error;
	const message = typeof e.message === "string" ? e.message : "Build failed";
	let file = null;
	if (typeof e.loc?.file === "string") file = e.loc.file;
	else if (typeof e.id === "string") file = e.id;
	return {
		message,
		file,
		line: typeof e.loc?.line === "number" ? e.loc.line : null
	};
}
function hookEnvironmentName(context) {
	return context.environment?.name ?? "shared";
}
const EDIT_FREE_RELOAD_MARKER = "edit-free";
/** Host-controlled default for `fullReload`; an explicit option still wins. */
const FULL_RELOAD_ENV_VAR = "MGX_HMR_FULL_RELOAD";
function hmrGatePlugin(options = {}) {
	const fullReload = options.fullReload ?? process.env["MGX_HMR_FULL_RELOAD"] !== "false";
	const gatedEvents = new Set(options.events ?? [
		"change",
		"add",
		"unlink"
	]);
	const passthroughPatterns = options.passthrough ?? [];
	const gateToken = options.token ?? process.env.MGX_HMR_GATE_TOKEN ?? "";
	let cacheDir = null;
	let publicDir = null;
	const pending = /* @__PURE__ */ new Map();
	const lastFlushedHashes = /* @__PURE__ */ new Map();
	let originalEmit = null;
	let server = null;
	let generation = null;
	const transformsByEnv = /* @__PURE__ */ new Map();
	const buildErrorsByEnv = /* @__PURE__ */ new Map();
	let bootProgressSentAt = 0;
	let bootProgressTimer = null;
	let lastBootProgressKey = "";
	function currentBuildError() {
		return buildErrorsByEnv.values().next().value ?? null;
	}
	function buildErrorKey(error) {
		return error ? `${error.message}:${error.file ?? ""}:${error.line ?? ""}` : "";
	}
	function bootProgressData() {
		const now = Date.now();
		const idle = (name) => {
			const at = transformsByEnv.get(name)?.lastTransformAt;
			return at === void 0 ? null : now - at;
		};
		return {
			ssrModules: transformsByEnv.get("ssr")?.ids.size ?? 0,
			clientModules: transformsByEnv.get("client")?.ids.size ?? 0,
			ssrIdleMs: idle("ssr"),
			clientIdleMs: idle("client"),
			buildError: currentBuildError()
		};
	}
	function bootProgressKey(data) {
		return `${data.ssrModules}:${data.clientModules}:${buildErrorKey(data.buildError)}`;
	}
	function broadcastBootProgress() {
		const data = bootProgressData();
		const key = bootProgressKey(data);
		if (key === lastBootProgressKey) return;
		lastBootProgressKey = key;
		bootProgressSentAt = Date.now();
		server?.ws.send({
			type: "custom",
			event: BOOT_PROGRESS_EVENT,
			data
		});
	}
	function scheduleBootProgress() {
		if (bootProgressTimer !== null) return;
		const waitMs = bootProgressSentAt + BOOT_PROGRESS_MIN_INTERVAL_MS - Date.now();
		if (waitMs <= 0) {
			broadcastBootProgress();
			return;
		}
		bootProgressTimer = setTimeout(() => {
			bootProgressTimer = null;
			broadcastBootProgress();
		}, waitMs);
		bootProgressTimer.unref?.();
	}
	let updateBatchSeq = 0;
	let updateBatch = null;
	let updateSentAt = 0;
	let lastUpdateKey = "";
	let updateTimer = null;
	let updateSettleTimer = null;
	function updateBatchModuleCount(b) {
		return (b.idsByEnv.get("ssr")?.size ?? 0) + (b.idsByEnv.get("client")?.size ?? 0);
	}
	function updateBatchEarned(b) {
		const total = updateBatchModuleCount(b);
		if (total >= UPDATE_MIN_MODULES) return true;
		return total > 0 && Date.now() - b.openedAt >= UPDATE_MIN_DURATION_MS;
	}
	function broadcastUpdateProgress(opts = {}) {
		const b = updateBatch;
		if (b === null) return;
		const trigger = opts.trigger ?? b.trigger;
		if (trigger !== "restart" && !updateBatchEarned(b)) return;
		const now = Date.now();
		const data = {
			batch: b.id,
			trigger,
			ssrModules: b.idsByEnv.get("ssr")?.size ?? 0,
			clientModules: b.idsByEnv.get("client")?.size ?? 0,
			idleMs: b.lastTransformAt === 0 ? null : now - b.lastTransformAt,
			done: opts.done ?? false,
			buildError: currentBuildError()
		};
		const key = `${data.batch}:${data.trigger}:${data.ssrModules}:${data.clientModules}:${data.done}:${buildErrorKey(data.buildError)}`;
		if (key === lastUpdateKey) return;
		lastUpdateKey = key;
		updateSentAt = now;
		server?.ws.send({
			type: "custom",
			event: UPDATE_PROGRESS_EVENT,
			data
		});
	}
	function scheduleUpdateProgress() {
		if (updateTimer !== null) return;
		const waitMs = updateSentAt + UPDATE_PROGRESS_MIN_INTERVAL_MS - Date.now();
		if (waitMs <= 0) {
			broadcastUpdateProgress();
			return;
		}
		updateTimer = setTimeout(() => {
			updateTimer = null;
			broadcastUpdateProgress();
		}, waitMs);
		updateTimer.unref?.();
	}
	function clearUpdateTimers() {
		if (updateTimer !== null) {
			clearTimeout(updateTimer);
			updateTimer = null;
		}
		if (updateSettleTimer !== null) {
			clearTimeout(updateSettleTimer);
			updateSettleTimer = null;
		}
	}
	function armUpdateSettle(delayMs) {
		if (updateSettleTimer !== null) clearTimeout(updateSettleTimer);
		updateSettleTimer = setTimeout(() => {
			updateSettleTimer = null;
			if (updateBatch === null) return;
			if (updateTimer !== null) {
				clearTimeout(updateTimer);
				updateTimer = null;
			}
			broadcastUpdateProgress({ done: true });
			updateBatch = null;
		}, delayMs);
		updateSettleTimer.unref?.();
	}
	function openWatchBatchIfNone() {
		if (updateBatch !== null) return;
		updateBatchSeq++;
		updateBatch = {
			id: updateBatchSeq,
			trigger: "watch",
			openedAt: Date.now(),
			idsByEnv: /* @__PURE__ */ new Map(),
			lastTransformAt: 0
		};
	}
	function noteUpdateFlush() {
		if (updateBatch === null) {
			updateBatchSeq++;
			updateBatch = {
				id: updateBatchSeq,
				trigger: "flush",
				openedAt: Date.now(),
				idsByEnv: /* @__PURE__ */ new Map(),
				lastTransformAt: 0
			};
		} else {
			updateBatch.trigger = "flush";
			if (updateBatch.lastTransformAt === 0) updateBatch.openedAt = Date.now();
		}
		scheduleUpdateProgress();
		armUpdateSettle(updateBatch.lastTransformAt === 0 ? UPDATE_FLUSH_SETTLE_MS : UPDATE_SETTLE_MS);
	}
	function noteUpdateRestart() {
		if (updateBatch === null) noteUpdateFlush();
		clearUpdateTimers();
		broadcastUpdateProgress({
			trigger: "restart",
			done: true
		});
		updateBatch = null;
	}
	function resetUpdateProgress() {
		clearUpdateTimers();
		updateBatch = null;
		updateBatchSeq = 0;
		updateSentAt = 0;
		lastUpdateKey = "";
	}
	let classicFailOpenTimer = null;
	let errorServedSinceFlush = false;
	let transportMode = false;
	let swallowedUpdates = 0;
	let heldReload = false;
	let passthroughReloads = 0;
	const wrappedSends = [];
	const drainMs = options.drainMs ?? 1500;
	const maxHoldMs = options.maxHoldMs ?? 24e4;
	// Experiment fork of 1.8.2: failOpen=false disables ALL hold-expiry releases.
	const holdTimer = callback => options.failOpen === false ? { unref() {} } : setTimeout(callback, maxHoldMs);
	const startupGraceMs = options.startupGraceMs ?? 5e3;
	let startupGraceUntil = 0;
	const patchPathRe = /^\/hmr_patch_\d+\.js(\?|$)/;
	const parked = [];
	let drainUntil = 0;
	let restartTimer = null;
	let reloadNeededListener = null;
	const bufferedReloadNeeded = /* @__PURE__ */ new Map();
	const pendingReplay = /* @__PURE__ */ new Map();
	let reloadFailOpenTimer = null;
	function replayBufferedReloadNeeded() {
		if (reloadNeededListener === null || bufferedReloadNeeded.size === 0) return;
		const entries = Array.from(bufferedReloadNeeded.entries());
		bufferedReloadNeeded.clear();
		for (const [client, payload] of entries) reloadNeededListener(payload, client);
	}
	function releaseParked() {
		const count = parked.length;
		for (const entry of parked.splice(0)) entry.release();
		return count;
	}
	function initialBuildPending() {
		const bundled = server?.environments?.client?.bundledDev;
		return bundled !== void 0 && bundled.initialBuildCompleted !== true;
	}
	function gateSendTarget(target) {
		const original = target.send.bind(target);
		wrappedSends.push({
			target,
			original
		});
		target.send = (...args) => {
			const frame = args[0];
			const type = frame?.type;
			if (type === "update") {
				swallowedUpdates++;
				openWatchBatchIfNone();
				return;
			}
			if (type === "full-reload") {
				if (frame?.ifFallback === true || frame?.mgx?.hmrGate === EDIT_FREE_RELOAD_MARKER || Date.now() < startupGraceUntil || initialBuildPending()) {
					passthroughReloads++;
					return original(...args);
				}
				heldReload = true;
				openWatchBatchIfNone();
				return;
			}
			return original(...args);
		};
	}
	function fileContentHash(filePath) {
		try {
			return createHash("sha1").update(readFileSync(filePath)).digest("hex");
		} catch {
			return null;
		}
	}
	function isPassthrough(filePath) {
		if (typeof filePath !== "string") return true;
		if (filePath.includes("node_modules/.vite")) return true;
		// Local patch: vite.config.ts may move cacheDir (MGX_GATE_CACHE_DIR).
		if (cacheDir && (filePath === cacheDir || filePath.startsWith(`${cacheDir}/`))) return true;
		// Local patch: Vite only learns about new public files from the watcher event; holding it
		// makes a new document's <img src="/new.png"> 404 until flush. Static assets are not code.
		if (publicDir && filePath.startsWith(`${publicDir}/`)) return true;
		return passthroughPatterns.some((p) => filePath.includes(p));
	}
	return {
		name: "hmr-gate",
		apply: "serve",
		configResolved(config) {
			transportMode = config.experimental?.bundledDev === true;
			cacheDir = typeof config.cacheDir === "string" ? config.cacheDir : null;
			publicDir = typeof config.publicDir === "string" && config.publicDir !== "" ? config.publicDir : null;
			const rawGeneration = process.env.MGX_SPAWN_GENERATION;
			const parsed = rawGeneration === void 0 || rawGeneration === "" ? null : Number(rawGeneration);
			generation = parsed !== null && Number.isSafeInteger(parsed) ? parsed : null;
		},
		transform(_code, id, options) {
			const name = this.environment?.name ?? (options?.ssr === true ? "ssr" : "client");
			let progress = transformsByEnv.get(name);
			if (!progress) {
				progress = {
					ids: /* @__PURE__ */ new Set(),
					lastTransformAt: 0
				};
				transformsByEnv.set(name, progress);
			}
			progress.ids.add(id);
			progress.lastTransformAt = Date.now();
			scheduleBootProgress();
			if (updateBatch !== null) {
				let batchIds = updateBatch.idsByEnv.get(name);
				if (!batchIds) {
					batchIds = /* @__PURE__ */ new Set();
					updateBatch.idsByEnv.set(name, batchIds);
				}
				batchIds.add(id);
				updateBatch.lastTransformAt = Date.now();
				scheduleUpdateProgress();
				if (updateBatch.trigger === "flush") armUpdateSettle(UPDATE_SETTLE_MS);
			}
			return null;
		},
		buildStart() {
			buildErrorsByEnv.delete(hookEnvironmentName(this));
			scheduleBootProgress();
		},
		buildEnd(error) {
			const name = hookEnvironmentName(this);
			const parsed = error == null ? null : firstBuildError(error);
			if (parsed === null) buildErrorsByEnv.delete(name);
			else buildErrorsByEnv.set(name, parsed);
			scheduleBootProgress();
		},
		configureServer(srv) {
			server = srv;
			transformsByEnv.clear();
			buildErrorsByEnv.clear();
			lastBootProgressKey = "";
			resetUpdateProgress();
			srv.ws.on?.("connection", (socket) => {
				try {
					socket.send(JSON.stringify({
						type: "custom",
						event: DEV_SERVER_MODE_EVENT,
						data: {
							mode: transportMode ? "bundled" : "classic",
							...generation !== null ? { generation } : {}
						}
					}));
					socket.send(JSON.stringify({
						type: "custom",
						event: BOOT_PROGRESS_EVENT,
						data: bootProgressData()
					}));
				} catch {}
			});
			if (transportMode) {
				const startedAtMs = Date.now();
				startupGraceUntil = startedAtMs + startupGraceMs;
				const ws = srv.ws;
				const hot = srv.environments?.client?.hot;
				const target = typeof ws?.send === "function" ? ws : hot;
				if (target && typeof target.send === "function") gateSendTarget(target);
				const hotChannel = hot;
				if (hotChannel && typeof hotChannel.on === "function") {
					const originalOn = hotChannel.on.bind(hotChannel);
					hotChannel.on = (event, listener) => {
						if (event !== "vite:bundled-dev:reload-needed") return originalOn(event, listener);
						reloadNeededListener = listener;
						originalOn(event, (payload, client) => {
							if (Date.now() < startupGraceUntil || initialBuildPending()) return listener(payload, client);
							bufferedReloadNeeded.set(client, payload);
							openWatchBatchIfNone();
							if (reloadFailOpenTimer === null) {
								reloadFailOpenTimer = holdTimer(() => {
									reloadFailOpenTimer = null;
									replayBufferedReloadNeeded();
								});
								reloadFailOpenTimer.unref?.();
							}
						});
					};
				}
				srv.middlewares.use((req, _res, next) => {
					if (req.method === "GET" && patchPathRe.test(req.url ?? "") && Date.now() >= drainUntil) {
						let released = false;
						const release = () => {
							if (released) return;
							released = true;
							clearTimeout(timer);
							const index = parked.indexOf(entry);
							if (index !== -1) parked.splice(index, 1);
							next();
						};
						const timer = holdTimer(release);
						timer.unref?.();
						const entry = { release };
						parked.push(entry);
						return;
					}
					next();
				});
				srv.middlewares.use((req, res, next) => {
					if (req.method !== "POST" || requestPathname(req) !== "/__hmr_flush") return next();
					if (!gateTokenAccepted(req, gateToken)) return rejectGateToken(res);
					const flushOrigin = req.headers.origin;
					if (typeof flushOrigin === "string" && !statusCorsOriginRe.test(flushOrigin)) {
						res.writeHead(403, { "Content-Type": "application/json" });
						res.end(JSON.stringify({ error: "origin not allowed" }));
						return;
					}
					const priorDrainUntil = drainUntil;
					const released = releaseParked();
					drainUntil = Date.now() + drainMs;
					const updates = swallowedUpdates;
					swallowedUpdates = 0;
					const broadcastHeld = heldReload;
					heldReload = false;
					const reload = broadcastHeld || bufferedReloadNeeded.size > 0;
					if (released > 0 || updates > 0 || reload) noteUpdateFlush();
					let flushRestarts = false;
					if (reload) {
						const releaseDelayMs = Math.max(released > 0 ? drainMs : 0, priorDrainUntil - Date.now(), 0);
						const restart = srv.restart;
						if (restartTimer !== null) clearTimeout(restartTimer);
						if (reloadFailOpenTimer !== null) {
							clearTimeout(reloadFailOpenTimer);
							reloadFailOpenTimer = null;
						}
						if (!broadcastHeld && bufferedReloadNeeded.size > 0 && reloadNeededListener !== null) {
							for (const [client, payload] of bufferedReloadNeeded) pendingReplay.set(client, payload);
							bufferedReloadNeeded.clear();
							restartTimer = setTimeout(() => {
								restartTimer = null;
								const entries = Array.from(pendingReplay.entries());
								pendingReplay.clear();
								for (const [client, payload] of entries) reloadNeededListener?.(payload, client);
							}, releaseDelayMs);
							restartTimer.unref?.();
						} else if (typeof restart === "function") {
							flushRestarts = true;
							noteUpdateRestart();
							bufferedReloadNeeded.clear();
							pendingReplay.clear();
							restartTimer = setTimeout(() => {
								restartTimer = null;
								restart.call(srv).catch(() => {
									if (wrappedSends.length > 0) wrappedSends[0].original({ type: "full-reload" });
								});
							}, releaseDelayMs);
							restartTimer.unref?.();
						} else if (wrappedSends.length > 0) {
							bufferedReloadNeeded.clear();
							pendingReplay.clear();
							wrappedSends[0].original({ type: "full-reload" });
						}
					}
					const body = JSON.stringify({
						flushed: [],
						count: released + updates,
						released,
						reload,
						restartsOnReload: flushRestarts,
						mode: "transport-patch-hold"
					});
					res.writeHead(200, { "Content-Type": "application/json" });
					res.end(body);
				});
				srv.middlewares.use((req, res, next) => {
					if (req.method !== "GET" || requestPathname(req) !== "/__hmr_gate") return next();
					if (!gateTokenAccepted(req, gateToken)) return rejectGateToken(res);
					const body = JSON.stringify({
						enabled: true,
						pending: {},
						count: parked.length + swallowedUpdates + (heldReload || bufferedReloadNeeded.size > 0 ? 1 : 0),
						heldReload: heldReload || bufferedReloadNeeded.size > 0,
						restartsOnReload: reloadNeededListener === null || heldReload,
						startedAt: startedAtMs,
						passthroughReloads,
						mode: "transport-patch-hold"
					});
					res.writeHead(200, gateStatusHeaders(req));
					res.end(body);
				});
				return;
			}
			srv.middlewares.use((req, res, next) => {
				// Local patch to upstream 1.8.2: gate live HMR, not a new
				// document's view of current source.
				// Invalidate transforms without releasing watcher events or reloading
				// existing clients; CheckUI uses this ordinary navigation path.
				if (pending.size > 0 && isHtmlNavigationRequest(req)) {
					srv.moduleGraph.invalidateAll();
					// The new document compiled the pending content, so the last flushed
					// hash no longer describes what clients run: a revert must be held and
					// flushed, not dropped as unchanged.
					for (const f of pending.keys()) lastFlushedHashes.delete(f);
				}
				const originalEnd = res.end.bind(res);
				res.end = ((...args) => {
					if (res.statusCode >= 500 && isHtmlNavigationRequest(req)) {
						errorServedSinceFlush = true;
						if (classicFailOpenTimer === null) {
							classicFailOpenTimer = holdTimer(() => {
								classicFailOpenTimer = null;
								flushPending();
							});
							classicFailOpenTimer.unref?.();
						}
					}
					return originalEnd(...args);
				});
				next();
			});
			const _emit = srv.watcher.emit.bind(srv.watcher);
			originalEmit = _emit;
			const flushPending = () => {
				if (classicFailOpenTimer !== null) {
					clearTimeout(classicFailOpenTimer);
					classicFailOpenTimer = null;
				}
				if (pending.size > 0) noteUpdateFlush();
				const errorServed = errorServedSinceFlush;
				errorServedSinceFlush = false;
				if (errorServed) srv.moduleGraph.invalidateAll();
				const entries = Array.from(pending.entries());
				pending.clear();
				for (const [f] of entries) srv.moduleGraph.onFileChange(f);
				if (entries.length > 0) {
					for (const [f, events] of entries) {
						for (const event of events) _emit(event, f);
						const hash = fileContentHash(f);
						if (hash === null) lastFlushedHashes.delete(f);
						else lastFlushedHashes.set(f, hash);
					}
					if (fullReload) srv.ws.send({ type: "full-reload" });
				}
				if (errorServed && (entries.length === 0 || !fullReload)) srv.ws.send({ type: "full-reload" });
				return {
					entries,
					errorRecovery: errorServed
				};
			};
			srv.watcher.emit = ((event, ...args) => {
				if (typeof event === "string" && gatedEvents.has(event) && !isPassthrough(args[0])) {
					const filePath = args[0];
					if (event === "change" || event === "add") {
						const hash = fileContentHash(filePath);
						if (hash !== null && hash === lastFlushedHashes.get(filePath)) {
							pending.delete(filePath);
							if (pending.size === 0 && !errorServedSinceFlush && classicFailOpenTimer !== null) {
								clearTimeout(classicFailOpenTimer);
								classicFailOpenTimer = null;
							}
							return false;
						}
					}
					let events = pending.get(filePath);
					if (!events) {
						events = /* @__PURE__ */ new Set();
						pending.set(filePath, events);
					}
					events.add(event);
					openWatchBatchIfNone();
					if (classicFailOpenTimer === null) {
						classicFailOpenTimer = holdTimer(() => {
							classicFailOpenTimer = null;
							flushPending();
						});
						classicFailOpenTimer.unref?.();
					}
					return false;
				}
				return _emit(event, ...args);
			});
			srv.middlewares.use((req, res, next) => {
				if (req.method !== "POST" || requestPathname(req) !== "/__hmr_flush") return next();
				if (!gateTokenAccepted(req, gateToken)) return rejectGateToken(res);
				const origin = req.headers.origin;
				if (typeof origin === "string" && !statusCorsOriginRe.test(origin)) {
					res.writeHead(403, { "Content-Type": "application/json" });
					res.end(JSON.stringify({ error: "origin not allowed" }));
					return;
				}
				const { entries, errorRecovery } = flushPending();
				const files = entries.map(([f]) => f);
				const body = JSON.stringify({
					flushed: files,
					count: entries.length,
					errorRecovery,
					mode: fullReload ? "full-reload" : "granular"
				});
				res.writeHead(200, { "Content-Type": "application/json" });
				res.end(body);
			});
			srv.middlewares.use((req, res, next) => {
				if (req.method !== "GET" || requestPathname(req) !== "/__hmr_gate") return next();
				if (!gateTokenAccepted(req, gateToken)) return rejectGateToken(res);
				const serialized = {};
				for (const [f, events] of pending) serialized[f] = Array.from(events);
				const body = JSON.stringify({
					enabled: true,
					pending: serialized,
					count: pending.size + (errorServedSinceFlush ? 1 : 0),
					errorRecovery: errorServedSinceFlush,
					mode: fullReload ? "full-reload" : "granular"
				});
				res.writeHead(200, gateStatusHeaders(req));
				res.end(body);
			});
		},
		closeWatcher() {
			if (server && originalEmit) server.watcher.emit = originalEmit;
			for (const { target, original } of wrappedSends) target.send = original;
			wrappedSends.length = 0;
			if (restartTimer !== null) {
				clearTimeout(restartTimer);
				restartTimer = null;
			}
			releaseParked();
			if (reloadFailOpenTimer !== null) {
				clearTimeout(reloadFailOpenTimer);
				reloadFailOpenTimer = null;
			}
			if (classicFailOpenTimer !== null) {
				clearTimeout(classicFailOpenTimer);
				classicFailOpenTimer = null;
			}
			if (bootProgressTimer !== null) {
				clearTimeout(bootProgressTimer);
				bootProgressTimer = null;
			}
			transformsByEnv.clear();
			buildErrorsByEnv.clear();
			bootProgressSentAt = 0;
			lastBootProgressKey = "";
			resetUpdateProgress();
			bufferedReloadNeeded.clear();
			pendingReplay.clear();
			reloadNeededListener = null;
			swallowedUpdates = 0;
			heldReload = false;
			passthroughReloads = 0;
			drainUntil = 0;
			pending.clear();
			lastFlushedHashes.clear();
			errorServedSinceFlush = false;
			server = null;
			originalEmit = null;
		}
	};
}
export { BOOT_PROGRESS_EVENT, DEV_SERVER_MODE_EVENT, FULL_RELOAD_ENV_VAR, UPDATE_PROGRESS_EVENT, hmrGatePlugin };
