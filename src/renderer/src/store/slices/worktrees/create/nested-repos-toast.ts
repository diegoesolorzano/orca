import { toast } from 'sonner'
import type { NestedRepoWarning } from '../../../../../../shared/worktree/create-types'

// Why (fork): a worktree of a meta-repo materializes none of the nested repos' files;
// without this warning the user lands in a silently incomplete tree. The field is only
// attached by local creates, so remote/folder flows pass undefined and this is a no-op.
export function showNestedReposToast(warning: NestedRepoWarning | undefined): void {
  if (!warning) {
    return
  }
  const more = warning.truncated && warning.moreCount > 0 ? ` and ${warning.moreCount} more` : ''
  toast.warning('Workspace created without nested repos', {
    description: `This repo contains nested git repos not tracked by it: ${warning.paths.join(', ')}${more}. The new worktree only contains files tracked by the parent repo.`
  })
}
