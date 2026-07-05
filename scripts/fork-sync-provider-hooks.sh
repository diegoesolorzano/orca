#!/usr/bin/env bash
# Fork-only: mirror Orca's managed Claude agent-hooks into the provider config
# dirs used by the kimi/minimax/zai wrappers, so those sessions show up in
# Orca's Activity / agents panel.
#
# Why: the wrappers export CLAUDE_CONFIG_DIR=~/.claude-<provider>, but Orca
# installs its hook only into ~/.claude/settings.json (it ignores
# CLAUDE_CONFIG_DIR). The Claude that a wrapper launches therefore reads a
# settings.json with no Orca hook, never POSTs status, and never appears in the
# panel. The hook itself is env-driven (ORCA_PANE_KEY / ORCA_AGENT_HOOK_PORT /
# ORCA_AGENT_HOOK_TOKEN, already injected into every Orca terminal), so copying
# the hook entries into the provider settings is enough — no other wiring.
#
# Idempotent + drift-proof: strips any prior Orca hook entries from each provider
# settings.json and re-adds the current ones from ~/.claude/settings.json. Run it
# again after an Orca update if the managed hook set changes. Restart running
# wrapper sessions afterward to pick up the hooks.
#
# Requires Orca to have started at least once (that is what writes the hooks into
# ~/.claude/settings.json). Provider dirs can be overridden via PROVIDER_DIRS
# (space-separated) and the source via CLAUDE_SETTINGS.
set -euo pipefail

SOURCE="${CLAUDE_SETTINGS:-$HOME/.claude/settings.json}"
read -r -a PROVIDER_DIRS <<<"${PROVIDER_DIRS:-$HOME/.claude-zai $HOME/.claude-kimi $HOME/.claude-minimax}"

if [[ ! -f "$SOURCE" ]]; then
  echo "error: $SOURCE not found — start Orca once so it installs the hook." >&2
  exit 1
fi

python3 - "$SOURCE" "${PROVIDER_DIRS[@]}" <<'PY'
import json, os, sys

source = sys.argv[1]
providers = sys.argv[2:]
MARK = 'agent-hooks/claude-hook.sh'

with open(source) as f:
    src_hooks = json.load(f).get('hooks', {})

# Per event, rebuild groups that contain ONLY Orca's hook commands (preserving
# the matcher) — never copy the user's unrelated personal hooks.
orca_by_event = {}
for event, groups in src_hooks.items():
    rebuilt = []
    for g in groups:
        marked = [h for h in g.get('hooks', []) if MARK in h.get('command', '')]
        if marked:
            ng = {k: v for k, v in g.items() if k != 'hooks'}
            ng['hooks'] = marked
            rebuilt.append(ng)
    if rebuilt:
        orca_by_event[event] = rebuilt

if not orca_by_event:
    print('error: no Orca hooks found in', source, file=sys.stderr)
    sys.exit(1)

for pdir in providers:
    if not os.path.isdir(pdir):
        print('skip (no dir):', pdir, file=sys.stderr)
        continue
    path = os.path.join(pdir, 'settings.json')
    data = {}
    if os.path.exists(path):
        with open(path) as f:
            data = json.load(f)
    hooks = data.get('hooks', {})
    # Drop existing Orca groups (drift-proof), keep the provider's own hooks.
    for event in list(hooks.keys()):
        hooks[event] = [
            g for g in hooks[event]
            if not any(MARK in h.get('command', '') for h in g.get('hooks', []))
        ]
        if not hooks[event]:
            del hooks[event]
    # Re-add the current Orca groups (deep-copied).
    for event, groups in orca_by_event.items():
        hooks.setdefault(event, []).extend(json.loads(json.dumps(groups)))
    data['hooks'] = hooks
    with open(path, 'w') as f:
        json.dump(data, f, indent=2)
        f.write('\n')
    print('synced', path)
PY

echo "done. Restart any running kimi/minimax/zai sessions to pick up the hooks."
