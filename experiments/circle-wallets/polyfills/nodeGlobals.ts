// Injected via vite.config.ts's optimizeDeps.esbuildOptions.inject, which
// prepends this file's top-level code to the START of every esbuild-
// bundled dependency chunk, guaranteeing it runs before any of that
// chunk's own module-init code. A plain top-level import in main.tsx is
// NOT sufficient here: ES module semantics evaluate all of a module's own
// static imports (including @circle-fin/w3s-pw-web-sdk's whole dependency
// graph) before that module's own top-level statements run, so a
// Buffer/process assignment placed in main.tsx would run too late,
// confirmed live (the SDK's bundled jsonwebtoken/jws/stream-browserify
// chain threw "process is not defined" during its own module evaluation,
// before main.tsx's own polyfill line was ever reached).
import { Buffer } from "buffer";
// @ts-expect-error no published type declarations for the "process" browser
// polyfill package; only used here for its side-effecting default export.
import process from "process";

Object.assign(globalThis, { Buffer, process });

export {};
