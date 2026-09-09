import { homedir } from 'os'

/**
 * Returns the current user's home directory.
 * Isolated so tests can replace home discovery with a scoped spy.
 */
export function getHomeDir(): string {
  return homedir()
}
