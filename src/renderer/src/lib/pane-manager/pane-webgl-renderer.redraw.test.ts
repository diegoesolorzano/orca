import { describe, expect, it, vi } from 'vitest'
import type { ManagedPaneInternal } from './pane-manager-types'
import { redrawPane } from './pane-webgl-renderer'

function makePane(overrides: {
  clearTextureAtlas?: () => void
  refresh?: (start: number, end: number) => void
  withAddon?: boolean
}): {
  pane: ManagedPaneInternal
  refresh: ReturnType<typeof vi.fn>
  clear: ReturnType<typeof vi.fn>
} {
  const refresh = vi.fn(overrides.refresh)
  const clear = vi.fn(overrides.clearTextureAtlas)
  const pane = {
    webglAddon: overrides.withAddon === false ? null : { clearTextureAtlas: clear },
    terminal: { rows: 24, refresh }
  } as unknown as ManagedPaneInternal
  return { pane, refresh, clear }
}

describe('redrawPane', () => {
  it('clears the WebGL atlas and repaints when an addon is attached', () => {
    const { pane, refresh, clear } = makePane({})

    redrawPane(pane)

    expect(clear).toHaveBeenCalledOnce()
    expect(refresh).toHaveBeenCalledWith(0, 23)
  })

  it('only repaints on a DOM pane with no WebGL addon', () => {
    const { pane, refresh, clear } = makePane({ withAddon: false })

    redrawPane(pane)

    expect(clear).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledWith(0, 23)
  })

  it('still repaints when clearTextureAtlas throws', () => {
    const { pane, refresh } = makePane({
      clearTextureAtlas: () => {
        throw new Error('GPU quirk')
      }
    })

    expect(() => redrawPane(pane)).not.toThrow()
    expect(refresh).toHaveBeenCalledWith(0, 23)
  })

  it('does not propagate a refresh failure on a disposed pane', () => {
    const { pane } = makePane({
      refresh: () => {
        throw new Error('disposed')
      }
    })

    expect(() => redrawPane(pane)).not.toThrow()
  })
})
