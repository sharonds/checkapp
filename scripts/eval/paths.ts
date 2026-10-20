import { existsSync, realpathSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

/**
 * Evaluation inputs and outputs contain article text and provider responses, which may be
 * client content. Refuse to write them anywhere inside a git working tree.
 */
export function assertOutsideGitRepo(path: string): void {
  // Resolve symlinks on the deepest part that exists, so a link into a repo is caught.
  let existing = resolve(path);
  let rest = "";
  while (!existsSync(existing) && dirname(existing) !== existing) {
    rest = join(basename(existing), rest);
    existing = dirname(existing);
  }
  let dir = join(realpathSync(existing), rest);
  for (;;) {
    if (existsSync(join(dir, ".git"))) {
      throw new Error(`Refusing to write evaluation data inside a git repository (${dir}). Use a private folder outside any repo.`);
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
