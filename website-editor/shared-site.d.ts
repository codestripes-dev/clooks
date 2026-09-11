declare module 'clooks:site' {
  import type { ComponentType, Context, ReactNode } from 'react'
  import type { PageData, RootProps, ContentItem } from './content-schema'
  export const Site: ComponentType<{ data: PageData }>
  export const SiteRoot: ComponentType<{ settings: RootProps; children?: ReactNode }>
  export const SiteSection: ComponentType<{
    type: ContentItem['type']
    content: ContentItem['props']
  }>
  export const PageEnvironment: Context<{ editing: boolean; targetWindow: Window | null }>
}
