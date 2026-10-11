// @vitest-environment happy-dom

/**
 * Wiring for the window-close/quit running-work warning. The policy in
 * `terminal/window-close-running-work.ts` is inert unless `proceedToNativeWindowClose` actually
 * consults it, so pin that it does — and that a warning stops the native close rather than
 * confirming it.
 */
import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { assessWindowCloseRunningWorkMock, confirmWindowCloseMock, abortWindowCloseMock } =
  vi.hoisted(() => ({
    assessWindowCloseRunningWorkMock: vi.fn(),
    confirmWindowCloseMock: vi.fn(),
    abortWindowCloseMock: vi.fn()
  }))

vi.mock('./terminal/window-close-running-work', () => ({
  assessWindowCloseRunningWork: assessWindowCloseRunningWorkMock
}))
vi.mock('./window-close-request-coordinator', () => ({
  runWithWindowCloseCheckpointScope: (fn: () => unknown) => fn()
}))
vi.mock('@/lib/shutdown-checkpoint-failure-toast', () => ({
  showShutdownCheckpointFailureToast: vi.fn()
}))

const { useTerminalEditorCloseFoundation } = await import('./use-terminal-editor-close-foundation')

const controller = { openFiles: [] } as unknown as Parameters<
  typeof useTerminalEditorCloseFoundation
>[0]

function mountFoundation() {
  return renderHook(() => useTerminalEditorCloseFoundation(controller))
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(globalThis, {
    window: Object.assign(globalThis.window, {
      api: {
        ui: { confirmWindowClose: confirmWindowCloseMock, abortWindowClose: abortWindowCloseMock }
      }
    })
  })
})

afterEach(() => {
  cleanup()
})

describe('proceedToNativeWindowClose', () => {
  it('asks the running-work policy about the quit rather than assuming it is safe', async () => {
    assessWindowCloseRunningWorkMock.mockResolvedValue({ kind: 'none' })
    const { result } = mountFoundation()

    await act(async () => {
      result.current.proceedToNativeWindowClose(true)
    })

    expect(assessWindowCloseRunningWorkMock).toHaveBeenCalledWith({ isQuitting: true })
    // Fork: Cmd+Q always asks, even with nothing running (upstream quits silently).
    expect(confirmWindowCloseMock).not.toHaveBeenCalled()
    expect(result.current.windowCloseDialogOpen).toBe(true)
    expect(result.current.windowCloseDialogKind).toBe('quit')
  })

  it('fork: a plain window close with nothing running still closes without asking', async () => {
    assessWindowCloseRunningWorkMock.mockResolvedValue({ kind: 'none' })
    const { result } = mountFoundation()

    await act(async () => {
      result.current.proceedToNativeWindowClose(false)
    })

    expect(confirmWindowCloseMock).toHaveBeenCalledTimes(1)
    expect(result.current.windowCloseDialogOpen).toBe(false)
  })

  it('fork: cancelling a Cmd+Q dialog clears the quit latch; cancelling a plain close does not', async () => {
    assessWindowCloseRunningWorkMock.mockResolvedValue({ kind: 'none' })
    const { result } = mountFoundation()

    await act(async () => {
      result.current.proceedToNativeWindowClose(true)
    })
    act(() => result.current.cancelWindowClose())
    expect(abortWindowCloseMock).toHaveBeenCalledTimes(1)
    expect(result.current.windowCloseDialogOpen).toBe(false)

    assessWindowCloseRunningWorkMock.mockResolvedValue({ kind: 'running' })
    await act(async () => {
      result.current.proceedToNativeWindowClose(false)
    })
    act(() => result.current.cancelWindowClose())
    expect(abortWindowCloseMock).toHaveBeenCalledTimes(1)
  })

  it('raises the dialog and does not close when a host reports live work', async () => {
    assessWindowCloseRunningWorkMock.mockResolvedValue({ kind: 'running' })
    const { result } = mountFoundation()

    await act(async () => {
      result.current.proceedToNativeWindowClose(true)
    })

    expect(result.current.windowCloseDialogOpen).toBe(true)
    expect(result.current.windowCloseDialogKind).toBe('running')
    expect(confirmWindowCloseMock).not.toHaveBeenCalled()
  })

  it('raises the unverifiable copy when a remote host could not be reached', async () => {
    assessWindowCloseRunningWorkMock.mockResolvedValue({ kind: 'unverifiable' })
    const { result } = mountFoundation()

    await act(async () => {
      result.current.proceedToNativeWindowClose(true)
    })

    expect(result.current.windowCloseDialogOpen).toBe(true)
    expect(result.current.windowCloseDialogKind).toBe('unverifiable')
    expect(confirmWindowCloseMock).not.toHaveBeenCalled()
  })

  // Why: a thrown assessment is not evidence either way, and a close that silently does nothing
  // leaves SIGKILL as the user's only exit.
  it('falls through to the close when the assessment throws', async () => {
    assessWindowCloseRunningWorkMock.mockRejectedValue(new Error('store blew up'))
    const { result } = mountFoundation()

    await act(async () => {
      result.current.proceedToNativeWindowClose(false)
    })

    expect(confirmWindowCloseMock).toHaveBeenCalledTimes(1)
    expect(result.current.windowCloseDialogOpen).toBe(false)
  })
})
