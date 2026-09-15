import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

for (const event of ['SIGTERM', 'SIGINT', 'uncaughtException', 'unhandledRejection']) {
  for (const paired of [false, true]) {
    test(`engine fatal ${event} drains only an owned approval lifecycle, paired=${paired}`, async () => {
      const root = mkdtempSync(join(tmpdir(), 'clooks-cli-signal-'))
      // Isolate dispatch from hooks/config while exercising the actual CLI listeners.
      const script = `
        import { mock } from 'bun:test'
        mock.module(${JSON.stringify(join(import.meta.dir, 'engine/index.ts'))}, () => ({
          EXIT_OK: 0,
          EXIT_STDERR: 2,
          async runEngine(deps) {
            if (${paired}) deps.onApprovalLifecycle(true)
            process.emit(${JSON.stringify(event)}, new Error('fixture fatal'))
            if (!deps.signal.aborted) await new Promise(resolve => setTimeout(resolve, 30000))
            await new Promise(resolve => setImmediate(resolve))
            process.stderr.write('approval cleanup completed\\n')
            deps.onApprovalLifecycle(false)
          },
        }))
        mock.module(${JSON.stringify(join(import.meta.dir, 'engine/run.ts'))}, () => ({ defaultDeps: {} }))
        await import(${JSON.stringify(join(import.meta.dir, 'cli.ts'))})
      `
      const started = Date.now()
      const child = Bun.spawn([process.execPath, '--eval', script], {
        cwd: root,
        env: { HOME: root, CLOOKS_HOME_ROOT: root, CLAUDECODE: '1' },
        stdin: 'ignore',
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const deadline = setTimeout(() => child.kill('SIGKILL'), 4000)
      try {
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        expect(code, stderr).toBe(paired ? 0 : 2)
        expect(Date.now() - started).toBeLessThan(5000)
        expect(stdout).toBe('')
        expect(stderr).toContain('clooks:')
        expect(stderr.includes('approval cleanup completed')).toBe(paired)
      } finally {
        clearTimeout(deadline)
        child.kill()
        await child.exited
        rmSync(root, { recursive: true, force: true })
      }
    })
  }
}
