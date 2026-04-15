import { describe, it, expect } from 'vitest'
import { normalizeGitUrl } from '../src/repo-id.js'

describe('normalizeGitUrl', () => {
  it('handles HTTPS with .git suffix', () => {
    expect(normalizeGitUrl('https://github.com/org/repo.git')).toBe('org/repo')
  })

  it('handles HTTPS without .git suffix', () => {
    expect(normalizeGitUrl('https://github.com/org/repo')).toBe('org/repo')
  })

  it('handles SSH format', () => {
    expect(normalizeGitUrl('git@github.com:org/repo.git')).toBe('org/repo')
  })

  it('handles SSH without .git suffix', () => {
    expect(normalizeGitUrl('git@github.com:org/repo')).toBe('org/repo')
  })

  it('lowercases the result', () => {
    expect(normalizeGitUrl('https://github.com/MyOrg/MyRepo.git')).toBe('myorg/myrepo')
  })

  it('throws on unparseable URL', () => {
    expect(() => normalizeGitUrl('not-a-url')).toThrow('Cannot parse')
  })
})
