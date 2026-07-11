// Every default on-disk path in this project that needs to survive a
// process restart (executor/paperExecutor.ts's decision log,
// server/db/decisionStore.ts's sqlite file) must resolve to the SAME
// location every time, regardless of the current working directory the
// process happens to be launched from. A path built from process.cwd()
// would silently look at (or create) a completely different data/ folder
// if launched from anywhere else, defeating the durability these modules
// exist to provide. Anchored to this file's own location instead.
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROJECT_ROOT = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/// @notice Builds a path under the project's own data/ directory (already
/// gitignored, see .gitignore), stable regardless of process.cwd().
export function projectDataPath(...segments: string[]): string {
  return path.join(PROJECT_ROOT, "data", ...segments);
}
