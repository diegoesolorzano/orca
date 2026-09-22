import { useCallback, useRef, useState } from 'react'
import { CLOSE_DIALOG_DEBOUNCE_MS } from './terminal-workspace-model'
import {
  assessWindowCloseRunningWork,
  type WindowCloseRunningWork
} from './terminal/window-close-running-work'
import type { TerminalWorkspaceProjectionController } from './use-terminal-workspace-projection'
import { runWithWindowCloseCheckpointScope } from './window-close-request-coordinator'
import { showShutdownCheckpointFailureToast } from '@/lib/shutdown-checkpoint-failure-toast'

export function useTerminalEditorCloseFoundation(
  controller: TerminalWorkspaceProjectionController
) {
  const { openFiles } = controller
  const [saveDialogFileId, setSaveDialogFileId] = useState<string | null>(null)
  const saveDialogFile = saveDialogFileId
    ? openFiles.find((file) => file.id === saveDialogFileId)
    : null
  const pendingEditorCloseQueueRef = useRef<string[]>([])
  const inFlightSaveFileIdRef = useRef<string | null>(null)
  const isClosingRef = useRef(false)
  const closeDialogDebounceTimersRef = useRef<Set<number>>(new Set())
  const releaseCloseDialogGuardAfterDebounce = useCallback(() => {
    const timer = window.setTimeout(() => {
      closeDialogDebounceTimersRef.current.delete(timer)
      isClosingRef.current = false
    }, CLOSE_DIALOG_DEBOUNCE_MS)
    closeDialogDebounceTimersRef.current.add(timer)
  }, [])
  const [windowCloseDialogOpen, setWindowCloseDialogOpen] = useState(false)
  // Why: "running" and "could not reach the host" are different claims, and telling the user
  // processes are running when the truth is that a host went quiet is the fabricated certainty
  // docs/reference/ssh-execution-boundary.md forbids.
  const [windowCloseDialogKind, setWindowCloseDialogKind] =
    useState<Exclude<WindowCloseRunningWork['kind'], 'none'>>('running')
  const windowCloseAfterDirtyRef = useRef<{ isQuitting: boolean } | null>(null)
  // Why (fork): remember whether the open confirm dialog came from a Cmd+Q so a
  // cancel can clear main's isQuitting latch (see cancelWindowClose).
  const windowCloseIsQuittingRef = useRef(false)

  const confirmNativeWindowClose = useCallback(() => {
    // Why: capture only after every close guard has committed. A canceled child-
    // process prompt must not consume App's synthetic/native unload guard.
    const accepted = runWithWindowCloseCheckpointScope(() =>
      window.dispatchEvent(new Event('beforeunload', { cancelable: true }))
    )
    if (!accepted) {
      // Why: a checkpoint-vetoed quit used to die here with no dialog and no log,
      // leaving SIGKILL as the only exit (#15352). Dirty-file vetoes publish no reason.
      showShutdownCheckpointFailureToast()
      return
    }
    window.api.ui.confirmWindowClose()
  }, [])

  const proceedToNativeWindowClose = useCallback(
    (isQuitting: boolean) => {
      void assessWindowCloseRunningWork({ isQuitting })
        .then((runningWork) => {
          if (runningWork.kind === 'none') {
            confirmNativeWindowClose()
            return
          }
          windowCloseIsQuittingRef.current = isQuitting
          setWindowCloseDialogKind(runningWork.kind)
          setWindowCloseDialogOpen(true)
        })
        // Why: the assessment must never be able to trap the window. A thrown store read is
        // not evidence either way, and a close that silently does nothing is unrecoverable
        // without SIGKILL, so fall through to the close the user actually asked for.
        .catch(() => {
          confirmNativeWindowClose()
        })
    },
    [confirmNativeWindowClose]
  )

  // Why (fork): a cancelled Cmd+Q must clear main's isQuitting latch so a later
  // plain window close isn't misclassified as a quit and the deferred service
  // teardown (relay/rate-limits/agent-awake) never runs. Plain closes leave the
  // latch untouched.
  const cancelWindowClose = useCallback(() => {
    setWindowCloseDialogOpen(false)
    if (windowCloseIsQuittingRef.current) {
      window.api.ui.abortWindowClose()
      windowCloseIsQuittingRef.current = false
    }
  }, [])

  return {
    saveDialogFileId,
    setSaveDialogFileId,
    saveDialogFile,
    pendingEditorCloseQueueRef,
    inFlightSaveFileIdRef,
    isClosingRef,
    closeDialogDebounceTimersRef,
    releaseCloseDialogGuardAfterDebounce,
    windowCloseDialogOpen,
    setWindowCloseDialogOpen,
    windowCloseDialogKind,
    windowCloseAfterDirtyRef,
    confirmNativeWindowClose,
    proceedToNativeWindowClose,
    cancelWindowClose
  }
}

export type TerminalEditorCloseFoundation = TerminalWorkspaceProjectionController &
  ReturnType<typeof useTerminalEditorCloseFoundation>
