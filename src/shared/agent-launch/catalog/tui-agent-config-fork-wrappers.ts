import type { TuiAgentConfigSource } from './tui-agent-config-types'

// Fork: Claude Code wrappers on other backends; see FORK-NOTES.md "agentes minimax / zai".
const FORK_CLAUDE_WRAPPER_AGENT_CONFIG: Record<'minimax' | 'zai', TuiAgentConfigSource> = {
  minimax: {
    // Why (fork): `minimax` is a wrapper that runs Claude Code against the
    // MiniMax backend via `exec -a minimax claude`, so the foreground process
    // is `minimax` and the prompt-injection surface is Claude's — it supports
    // `--prefill` just like the `claude` agent.
    detectCmd: 'minimax',
    launchCmd: 'minimax',
    expectedProcess: 'minimax',
    promptInjectionMode: 'argv',
    draftPromptFlag: '--prefill'
  },
  zai: {
    // Why (fork): `zai` is a wrapper that runs Claude Code against the z.ai/GLM
    // backend via `exec -a zai claude`, so the foreground process is `zai` and
    // the prompt-injection surface is Claude's — it supports `--prefill`.
    detectCmd: 'zai',
    launchCmd: 'zai',
    expectedProcess: 'zai',
    promptInjectionMode: 'argv',
    draftPromptFlag: '--prefill'
  }
}

export function withForkClaudeWrappers<T extends object>(
  source: T
): T & Record<'minimax' | 'zai', TuiAgentConfigSource> {
  return { ...source, ...FORK_CLAUDE_WRAPPER_AGENT_CONFIG }
}
