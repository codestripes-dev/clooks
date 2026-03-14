import { homedir } from 'os'

/**
 * Returns the current user's home directory.
 * Extracted into its own module so tests can mock it via mock.module().
 */
export function getHomeDir(): string {
  return homedir()
}
