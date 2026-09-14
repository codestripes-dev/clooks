import { lstat, readFile, realpath } from 'node:fs/promises'
import { resolve, join } from 'node:path'

export const websiteRoot = resolve(import.meta.dir, '..')
export const sourceScripts = [
  'responsive.jsx',
  'site.jsx',
  'hero.jsx',
  'sections/_helpers.jsx',
  'sections/problem.jsx',
  'sections/hook-in-action.jsx',
  'sections/hook-anatomy.jsx',
  'sections/captures.jsx',
  'sections/config.jsx',
  'sections/ordering.jsx',
  'sections/scoped-config.jsx',
  'sections/tmux-hook.jsx',
  'sections/comparison.jsx',
  'sections/install.jsx',
  'sections/why-not-plugin.jsx',
  'sections/faq.jsx',
  'sections/footer.jsx',
  'content.jsx',
]
export const staticFiles = [
  'favicon.svg',
  'codex.svg',
  'og-image.png',
  'version.js',
  'llms.txt',
  'vendor/react@18.3.1.min.js',
  'vendor/react-dom@18.3.1.min.js',
  'vendor/fonts/fonts.css',
  'vendor/fonts/geist-400.woff2',
  'vendor/fonts/geist-500.woff2',
  'vendor/fonts/geist-600.woff2',
  'vendor/fonts/jetbrains-mono-400.woff2',
  'vendor/fonts/jetbrains-mono-500.woff2',
  'vendor/fonts/jetbrains-mono-600.woff2',
]
export const transpiler = new Bun.Transpiler({
  loader: 'jsx',
  tsconfig: JSON.stringify({
    compilerOptions: {
      jsx: 'react',
      jsxFactory: 'React.createElement',
      jsxFragmentFactory: 'React.Fragment',
    },
  }),
})

export async function readSafe(root: string, relative: string): Promise<Buffer> {
  const base = await realpath(root)
  const pieces = relative.split('/')
  if (pieces.some((p) => !p || p === '.' || p === '..')) throw new Error('Invalid asset path')
  let path = base
  for (const piece of pieces) {
    path = join(path, piece)
    if ((await lstat(path)).isSymbolicLink()) throw new Error('Symlinks are not allowed')
  }
  if ((await realpath(path)) !== path || !(await lstat(path)).isFile())
    throw new Error('Not a regular asset')
  return readFile(path)
}

export function transformPageHtml(html: string): string {
  return html
    .replace(/\n?<script src="https:\/\/unpkg\.com\/@babel\/standalone[^\n]+\n/g, '\n')
    .replace(
      /<script type="text\/babel" src="([^"]+)\.jsx"><\/script>/g,
      '<script defer src="$1.js"></script>',
    )
    .replace(/<script src="([^"]+)"><\/script>/g, '<script defer src="$1"></script>')
}

export async function pageAssets(): Promise<
  Map<string, { body: Uint8Array | string; type: string }>
> {
  const assets = new Map<string, { body: Uint8Array | string; type: string }>()
  const index = (await readSafe(websiteRoot, 'page/index.html')).toString()
  assets.set('/', { body: transformPageHtml(index), type: 'text/html; charset=utf-8' })
  for (const file of staticFiles)
    assets.set('/' + file, {
      body: await readSafe(websiteRoot, 'page/' + file),
      type: Bun.file(file).type,
    })
  for (const file of [...sourceScripts, 'app.jsx'])
    assets.set('/' + file.replace(/\.jsx$/, '.js'), {
      body: transpiler.transformSync((await readSafe(websiteRoot, 'page/' + file)).toString()),
      type: 'text/javascript; charset=utf-8',
    })
  return assets
}

export async function sharedComponentsSource(): Promise<string> {
  const scripts = await Promise.all(
    sourceScripts.map(async (file) =>
      (await readSafe(websiteRoot, 'page/' + file))
        .toString()
        .replace(/^Object\.assign\(window,.*\);?$/gm, ''),
    ),
  )
  return (
    "import React from 'react';\n" +
    scripts.join('\n') +
    '\nexport { Site, SiteRoot, SiteSection, PageEnvironment };\n'
  )
}
