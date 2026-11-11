import type { KeybindingDefinition } from './types'
import { platformBindings } from './definitions-support'

// Fork: Mod+Alt+L recovers a corrupted WebGL glyph atlas (orca-5031).
export const FORK_TERMINAL_REDRAW_KEYBINDING: KeybindingDefinition = {
  id: 'terminal.redraw',
  title: 'Redraw terminal',
  group: 'Terminal Panes',
  scope: 'terminal',
  searchKeywords: ['shortcut', 'redraw', 'repaint', 'glyph', 'atlas', 'corrupt', 'webgl'],
  defaultBindings: platformBindings(['Mod+Alt+L'])
}
