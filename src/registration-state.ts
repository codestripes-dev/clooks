import * as fs from 'node:fs'
import { join } from 'node:path'
import { isCodexClooksHook, resolveCodexHome } from './agents/codex/settings.js'
import {
  readRegistrationFile,
  validateRegistrationGroups,
  writeRegistrationFileAtomic,
} from './registration-file.js'
import { isCodexRuntimeAdvisoryHook } from './registration-advisory.js'

const RECEIPT = '.global-entrypoint-active.codex'
const TRACKED_HOME = '.codex-registration-home'
const RECEIPT_VERSION = 'clooks-codex-registration-v1'
const HOME_VERSION = 'clooks-codex-home-v1'
const DECIMAL = '(?:0|[1-9][0-9]*)'
const CHECKSUM = new RegExp(`^${DECIMAL}:${DECIMAL}$`)

export interface CodexRegistrationReceipt {
  version: 1
  homeRoot: string
  codexHome: string
  checksum: string
}

export type CodexReceiptState =
  | { kind: 'missing' }
  | { kind: 'legacy' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'receipt'; value: CodexRegistrationReceipt }

export type CodexTrackedHomeState =
  | { kind: 'missing' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'home'; codexHome: string }

function physicalHome(homeRoot: string): string {
  return resolveCodexHome(homeRoot, { CODEX_HOME: homeRoot })
}

function statePath(homeRoot: string, name: string): string {
  return join(physicalHome(homeRoot), '.clooks', name)
}

function readState(
  path: string,
): { text: string } | { kind: 'missing' | 'invalid'; reason: string } {
  const stat = fs.lstatSync(path, { throwIfNoEntry: false })
  if (!stat) return { kind: 'missing', reason: '' }
  if (!stat.isFile()) {
    return {
      kind: 'invalid',
      reason: `\`${path}\` must be a regular file, not a symlink or other file type. Repair the path, then retry.`,
    }
  }
  return { text: fs.readFileSync(path, 'utf8') }
}

function invalid(path: string, field: string): { kind: 'invalid'; reason: string } {
  return {
    kind: 'invalid',
    reason: `\`${path}\` contains invalid ${field}. Repair the file, then retry.`,
  }
}

function canonicalPath(value: string): boolean {
  if (!value.startsWith('/') || /[\r\n\0]/.test(value)) return false
  return physicalHome(value) === value
}

export function readCodexReceipt(homeRoot: string): CodexReceiptState {
  const path = statePath(homeRoot, RECEIPT)
  const state = readState(path)
  if ('kind' in state)
    return state.kind === 'missing'
      ? { kind: 'missing' }
      : { kind: 'invalid', reason: state.reason }
  if (state.text === '') return { kind: 'legacy' }
  const lines = state.text.split('\n')
  if (lines.length !== 5 || lines[4] !== '' || lines[0] !== RECEIPT_VERSION)
    return invalid(path, 'receipt format')
  const [, installation, codexHome, checksum] = lines as [string, string, string, string, string]
  if (!canonicalPath(installation) || installation !== physicalHome(homeRoot))
    return invalid(path, 'homeRoot identity')
  if (!canonicalPath(codexHome)) return invalid(path, 'codexHome identity')
  if (!CHECKSUM.test(checksum) || checksum.includes('\n')) return invalid(path, 'checksum')
  return { kind: 'receipt', value: { version: 1, homeRoot: installation, codexHome, checksum } }
}

export function readCodexTrackedHome(homeRoot: string): CodexTrackedHomeState {
  const path = statePath(homeRoot, TRACKED_HOME)
  const state = readState(path)
  if ('kind' in state)
    return state.kind === 'missing'
      ? { kind: 'missing' }
      : { kind: 'invalid', reason: state.reason }
  const lines = state.text.split('\n')
  if (lines.length !== 3 || lines[2] !== '' || lines[0] !== HOME_VERSION)
    return invalid(path, 'recovery record format')
  const codexHome = lines[1]!
  if (!canonicalPath(codexHome)) return invalid(path, 'codexHome identity')
  return { kind: 'home', codexHome }
}

function inspectState(homeRoot: string) {
  const receipt = readCodexReceipt(homeRoot)
  const tracked = readCodexTrackedHome(homeRoot)
  if (receipt.kind === 'invalid') throw new Error(receipt.reason)
  if (tracked.kind === 'invalid') throw new Error(tracked.reason)
  const receiptHome =
    receipt.kind === 'receipt'
      ? receipt.value.codexHome
      : receipt.kind === 'legacy'
        ? resolveCodexHome(homeRoot, {})
        : undefined
  const trackedHome = tracked.kind === 'home' ? tracked.codexHome : undefined
  if (receiptHome && trackedHome && receiptHome !== trackedHome) {
    throw new Error(
      `\`${statePath(homeRoot, RECEIPT)}\` and \`${statePath(homeRoot, TRACKED_HOME)}\` contain conflicting Codex home identities (${receiptHome}, ${trackedHome}). Repair the records, then retry.`,
    )
  }
  return { receipt, tracked, codexHome: trackedHome ?? receiptHome }
}

function assertSelectedHome(homeRoot: string, codexHome: string): string {
  const selected = physicalHome(codexHome)
  const state = inspectState(homeRoot)
  if (state.codexHome && state.codexHome !== selected) {
    throw new Error(
      `\`${statePath(homeRoot, TRACKED_HOME)}\` or \`${statePath(homeRoot, RECEIPT)}\` records Codex home \`${state.codexHome}\`. Unhook that home with CODEX_HOME before initializing \`${selected}\`.`,
    )
  }
  return selected
}

export function trackCodexHome(homeRoot: string, codexHome: string): void {
  const selected = assertSelectedHome(homeRoot, codexHome)
  const path = statePath(homeRoot, TRACKED_HOME)
  fs.mkdirSync(join(physicalHome(homeRoot), '.clooks'), { recursive: true })
  writeRegistrationFileAtomic(path, `${HOME_VERSION}\n${selected}\n`)
}

export function publishCodexReceipt(homeRoot: string, codexHome: string): void {
  const selected = assertSelectedHome(homeRoot, codexHome)
  const installation = physicalHome(homeRoot)
  const launcher = join(installation, '.clooks/bin/entrypoint.sh')
  if (!fs.statSync(launcher).isFile())
    throw new Error(`\`${launcher}\` must be an executable file.`)
  fs.accessSync(launcher, fs.constants.X_OK)
  const hooksPath = join(selected, 'hooks.json')
  if (!fs.lstatSync(hooksPath).isFile())
    throw new Error(`\`${hooksPath}\` must be a regular file, not a symlink or other file type.`)
  const bytes = fs.readFileSync(hooksPath)
  const result = (() => {
    try {
      return Bun.spawnSync(['cksum'], {
        stdin: bytes,
        stdout: 'pipe',
        stderr: 'pipe',
        timeout: 10_000,
        killSignal: 'SIGKILL',
      })
    } catch (cause) {
      throw new Error(
        `Could not execute POSIX cksum for \`${hooksPath}\`. Check cksum availability and retry.`,
        { cause },
      )
    }
  })()
  const output = result.stdout.toString()
  const match = new RegExp(`^(${DECIMAL})[ \\t]+(${DECIMAL})\\n$`).exec(output)
  if (
    result.exitCode !== 0 ||
    result.signalCode ||
    !match ||
    match[0] !== output ||
    match[2] !== String(bytes.byteLength)
  ) {
    throw new Error(
      `Could not compute POSIX cksum for \`${hooksPath}\`. Check cksum availability and retry.`,
    )
  }
  writeRegistrationFileAtomic(
    statePath(installation, RECEIPT),
    `${RECEIPT_VERSION}\n${installation}\n${selected}\n${match[1]}:${match[2]}\n`,
  )
}

export function clearCodexRegistrationState(homeRoot: string, codexHome: string): boolean {
  const selected = physicalHome(codexHome)
  const state = inspectState(homeRoot)
  if (state.codexHome !== selected) return false
  const hooksPath = join(selected, 'hooks.json')
  const { hooks } = readRegistrationFile(hooksPath)
  for (const [event, value] of Object.entries(hooks)) {
    if (
      validateRegistrationGroups(value, hooksPath, `hooks.${event}`).some((group) =>
        group.hooks.some((hook) => isCodexClooksHook(hook) || isCodexRuntimeAdvisoryHook(hook)),
      )
    ) {
      throw new Error(
        `\`${hooksPath}\` still contains Clooks references at hooks.${event}. Remove those references before clearing registration state.`,
      )
    }
  }
  // Keep a cleanup identity if removing either state file fails.
  if (state.receipt.kind !== 'missing') fs.unlinkSync(statePath(homeRoot, RECEIPT))
  if (state.tracked.kind !== 'missing') fs.unlinkSync(statePath(homeRoot, TRACKED_HOME))
  return true
}
