#!/usr/bin/env bun
// Regenerates page/version.js from src/version.ts.
// Wired into build:page so the landing page version indicators
// stay in lockstep with the CLI's VERSION constant.

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { VERSION } from '../src/version'
import { formatPageVersion } from './sync-release-version'

function main(): void {
  const here = dirname(fileURLToPath(import.meta.url))
  const path = resolve(here, '../page/version.js')
  const output = formatPageVersion(VERSION)
  if (!existsSync(path) || readFileSync(path, 'utf8') !== output) writeFileSync(path, output)
  console.log(`page/version.js synced to ${VERSION}`)
}

if (import.meta.main) main()
