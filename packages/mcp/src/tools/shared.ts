import { ValidationError } from '@twograph/core';
import { openRepoContext, type RepoContext } from '../context.js';

/** Opens a repo context, verifies it's actually been indexed, and always closes it. */
export async function withRepo<T>(
  repoPath: string,
  fn: (ctx: RepoContext) => Promise<T> | T,
): Promise<T> {
  const ctx = openRepoContext(repoPath);
  try {
    if (!ctx.store.getRepository(ctx.repo.id)) {
      throw new ValidationError(
        `no index found for ${ctx.repo.rootPath} — run "twograph index" first`,
      );
    }
    return await fn(ctx);
  } finally {
    await ctx.close();
  }
}
