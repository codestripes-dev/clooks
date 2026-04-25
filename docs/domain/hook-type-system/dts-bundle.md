# Hook Type System — `.d.ts` Type Declarations

How the public type surface is bundled into a single `.d.ts` file, embedded in the binary, and extracted to hook directories.

## Overview

Hook authors get full TypeScript type support via a generated `types.d.ts` file placed in the hooks directory (`.clooks/hooks/types.d.ts` for project scope, `~/.clooks/hooks/types.d.ts` for global scope). This file contains the complete public type surface — `ClooksHook`, all 22 event contexts, all result types, config generics, and branded string unions.

## Build pipeline

The build pipeline produces a single `.d.ts` file and embeds it in the compiled binary:

1. **Generate** — `scripts/generate-types.ts` runs `dts-bundle-generator` with `--no-check` and `--export-referenced-types=false` against `src/types/index.ts`. Output goes to `src/generated/clooks-types.d.ts` (gitignored).
2. **Embed** — The binary imports the generated file as a string constant via Bun text import: `import EMBEDDED_TYPES_DTS from '../generated/clooks-types.d.ts' with { type: 'text' }`. TypeScript is satisfied by an ambient module declaration in `src/text-imports.d.ts`. This works in both `bun run` (interpreted) and `bun build --compile` (compiled binary).
3. **Extract** — `clooks types` and `clooks init` write the embedded string to disk as `types.d.ts` with a version header comment.

## Source of truth vs. generated artifact

`src/types/index.ts` is the source of truth for the public type surface. It re-exports exactly 73 types from the submodules in `src/types/`. The generated `.clooks/hooks/types.d.ts` is a build artifact derived entirely from this barrel — hook authors should never edit it. Running `clooks types` regenerates it from the binary's embedded copy.

## Hook author import

Hook files import types from the co-located declarations file:

```typescript
import type { ClooksHook } from './types'
```

This replaces the previous repo-internal import (`../../src/types/hook.js`) and works in any project directory after `clooks init` or `clooks types`.
