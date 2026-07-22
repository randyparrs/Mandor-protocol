// Regression coverage for a real concern: a default data
// path built from process.cwd() (the bug this file exists to prevent) would
// silently resolve to a different location if the process were ever
// launched from a directory other than the project root, breaking the
// whole point of durable storage surviving a restart.
import { describe, it, after as onSuiteEnd } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { projectDataPath } from "../shared/paths.js";

describe("projectDataPath", () => {
  it("resolves under this project's own data/ directory", () => {
    const resolved = projectDataPath("mandate.db");
    assert.ok(path.isAbsolute(resolved));
    assert.ok(resolved.endsWith(path.join("data", "mandate.db")));
    assert.ok(!resolved.includes("node_modules"));
  });

  it("resolves to the exact same absolute path regardless of process.cwd() at call time", () => {
    const before = projectDataPath("mandate.db");
    const originalCwd = process.cwd();
    onSuiteEnd(() => process.chdir(originalCwd));

    process.chdir(path.parse(originalCwd).root); // simulate launching from an unrelated directory
    const resolvedFromElsewhere = projectDataPath("mandate.db");
    assert.equal(resolvedFromElsewhere, before);
  });
});
