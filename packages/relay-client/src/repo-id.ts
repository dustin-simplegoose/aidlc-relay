/**
 * Repo ID Derivation — reads git remote and normalizes to org/repo.
 */

import { execSync } from 'node:child_process'

export function deriveRepoId(cwd?: string): string {
  let url: string
  try {
    url = execSync('git remote get-url origin', {
      encoding: 'utf-8',
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim()
  } catch {
    throw new Error('Relay requires a git remote. Run "git remote add origin <url>" first.')
  }

  return normalizeGitUrl(url)
}

export function normalizeGitUrl(url: string): string {
  // SSH: git@github.com:org/repo.git
  const sshMatch = url.match(/^git@[^:]+:(.+?)(?:\.git)?$/)
  if (sshMatch) return sshMatch[1].toLowerCase()

  // HTTPS: https://github.com/org/repo.git
  try {
    const parsed = new URL(url)
    const path = parsed.pathname.replace(/^\//, '').replace(/\.git$/, '')
    return path.toLowerCase()
  } catch {
    throw new Error(`Cannot parse git remote URL: ${url}`)
  }
}
