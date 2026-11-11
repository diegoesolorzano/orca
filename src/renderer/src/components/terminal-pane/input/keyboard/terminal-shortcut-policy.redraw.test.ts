import { describe, expect, it } from 'vitest'
import {
  resolveTerminalShortcutAction,
  type TerminalShortcutEvent
} from './terminal-shortcut-policy'

// Fork: the redraw shortcut (Mod+Alt+L) is a fork-only action; upstream pruned the suite that held it.
function event(overrides: Partial<TerminalShortcutEvent>): TerminalShortcutEvent {
  return {
    key: '',
    code: '',
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    shiftKey: false,
    repeat: false,
    ...overrides
  }
}

describe('resolveTerminalShortcutAction redraw (fork)', () => {
  it('resolves the redraw terminal shortcut on both platforms', () => {
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'l', code: 'KeyL', metaKey: true, altKey: true }),
        true
      )
    ).toEqual({ type: 'redrawActivePane' })
    expect(
      resolveTerminalShortcutAction(
        event({ key: 'l', code: 'KeyL', ctrlKey: true, altKey: true }),
        false,
        'false',
        0,
        true
      )
    ).toEqual({ type: 'redrawActivePane' })
  })
})
