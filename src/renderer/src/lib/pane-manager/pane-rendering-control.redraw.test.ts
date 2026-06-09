import { describe, expect, it, vi } from 'vitest'
import type { ManagedPaneInternal } from './pane-manager-types'

const redrawPaneMock = vi.hoisted(() => vi.fn())

vi.mock('./pane-webgl-renderer', () => ({
  attachWebgl: vi.fn(),
  disposeWebgl: vi.fn(),
  markComplexScriptOutput: vi.fn(),
  redrawPane: redrawPaneMock
}))
vi.mock('./pane-tree-ops', () => ({ safeFit: vi.fn() }))
vi.mock('./pane-webgl-reattach', () => ({ reattachWebglIfNeeded: vi.fn() }))

import { redrawPaneById } from './pane-rendering-control'

describe('redrawPaneById', () => {
  it('redraws the pane matching the id', () => {
    redrawPaneMock.mockClear()
    const pane = { id: 7 } as unknown as ManagedPaneInternal
    const panes = new Map<number, ManagedPaneInternal>([[7, pane]])

    redrawPaneById(panes, 7)

    expect(redrawPaneMock).toHaveBeenCalledWith(pane)
  })

  it('is a no-op when the id is not present', () => {
    redrawPaneMock.mockClear()
    const panes = new Map<number, ManagedPaneInternal>()

    expect(() => redrawPaneById(panes, 99)).not.toThrow()
    expect(redrawPaneMock).not.toHaveBeenCalled()
  })
})
