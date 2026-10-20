import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * Evaluation inputs and outputs contain article text and provider responses, which may be
 * client content. Refuse to write them anywhere inside a git working tree.
 */
export function assertOutsideGitRepo(path: string): void {
  let dir = resolve(path);
  for (;;) {
    if (existsSync(join(dir, ".git"))) {
      throw new Error(`Refusing to write evaluation data inside a git repository (${dir}). Use a private folder outside any repo.`);
    }
    const parent = dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}
