# Vendored hmr-gate

Source: vite-plugin-hmr-gate 1.8.2 `dist/index.js`, MIT license (notice kept at the
top of the `.mjs`). Event names, env vars and the Origin allowlist are renamed or
trimmed for MGX; see the "Local patch" comments.

Loaded only when `MGX_VALIDATED_HMR=1`.

Local patches (search "Local patch" / "Experiment fork" in the `.mjs`):
- `holdTimer`: `failOpen: false` disables the hold-expiry timers. The template does not
  pass it, so held updates are released `maxHoldMs` (240s) after the first held change,
  whether or not the validation controller is alive. The timer is not reset by later changes.
- HTML navigation while updates are pending calls `moduleGraph.invalidateAll()`, so a new
  document (including CheckUI) sees current source without releasing held HMR to open
  pages. It also clears those files' last-flushed hashes, so reverting a file to its last
  flushed content is still held and flushed.
- `token` / `MGX_HMR_GATE_TOKEN`: when set, `/__hmr_gate` and `/__hmr_flush` require a
  matching `x-mgx-hmr-token` header. Unset keeps the upstream behavior.
- Files under the resolved `config.cacheDir` and `config.publicDir` pass through.
- Renamed: custom events `mgx:*`, env vars `MGX_HMR_FULL_RELOAD` / `MGX_SPAWN_GENERATION`;
  the Origin allowlist accepts localhost only.

The gate only holds watcher events for open pages. Reloading, opening a new tab, or a
first visit loads current source from disk, and Vite errors or dependency re-optimization
reloads triggered by such a navigation reach all clients. Source publication is not atomic.

`/__hmr_flush` releases every pending file and Vite reads them from disk when replayed;
it does not check them against the validated revision. The controller (mgx-tool) relies
on validating one revision at a time per project and re-checking the source revision
right before it flushes. A write after that check, or before the browser fetches the
module, is published unvalidated.

The template runs vite ^5 (classic mode); the `experimental.bundledDev` transport code is
unreachable and kept as upstream apart from the token check. Types: `hmr-gate-1.8.2.d.mts`.
Tests: `plugins/hmr-gate.test.ts`.
