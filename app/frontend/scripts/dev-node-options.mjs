// On Node 22, require(esm) caches tailwind.config.ts, so config edits never reach
// the running dev server; --no-experimental-require-module restores tailwind's
// reloadable loader. Older Node rejects the flag, so add it only when supported.
const FLAG = '--no-experimental-require-module';

export function devNodeOptions(nodeOptions = '', allowedFlags = process.allowedNodeEnvironmentFlags) {
  const current = nodeOptions.trim();
  if (!allowedFlags.has(FLAG) || current.split(/\s+/).includes(FLAG)) return current;
  return current ? `${current} ${FLAG}` : FLAG;
}
