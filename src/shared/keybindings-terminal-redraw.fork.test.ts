import { describe, expect, it } from 'vitest'
import { getEffectiveKeybindingsForAction } from './keybindings'

// Fork feature: the terminal.redraw shortcut (Mod+Alt+L) recovers a WebGL pane
// with a corrupt glyph atlas (issue #5031) without switching tabs.
describe('fork: terminal.redraw keybinding', () => {
  it('defines the redraw-terminal shortcut on every platform', () => {
    for (const platform of ['darwin', 'linux', 'win32'] as const) {
      expect(getEffectiveKeybindingsForAction('terminal.redraw', platform)).toEqual(['Mod+Alt+L'])
    }
  })
})
