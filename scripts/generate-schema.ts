#!/usr/bin/env bun
// Build script: generates clooks.schema.json from the Zod schema.
// Usage: bun run scripts/generate-schema.ts

import { generateJsonSchema } from "../src/config/schema.js"
import { writeFileSync } from "fs"
import { join } from "path"

const schema = generateJsonSchema()

// Add metadata
const enriched = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://clooks.cc/schemas/clooks.schema.json",
  title: "clooks.yml",
  description: "Configuration file for Clooks — a hook runtime for AI coding agents.",
  ...schema,
}

const outputPath = join(import.meta.dir, "../schemas/clooks.schema.json")
writeFileSync(outputPath, JSON.stringify(enriched, null, 2) + "\n")
console.log(`Generated ${outputPath}`)
