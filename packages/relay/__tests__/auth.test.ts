import { describe, it, expect } from 'vitest'
import { createAuthConfig, validateToken, extractBearerToken } from '../src/auth.js'

describe('Auth', () => {
  describe('createAuthConfig', () => {
    it('parses comma-separated keys', () => {
      const config = createAuthConfig('key1,key2,key3')
      expect(config.teamApiKeys).toEqual(['key1', 'key2', 'key3'])
    })

    it('trims whitespace', () => {
      const config = createAuthConfig(' key1 , key2 ')
      expect(config.teamApiKeys).toEqual(['key1', 'key2'])
    })

    it('throws on empty string', () => {
      expect(() => createAuthConfig('')).toThrow('at least one key')
    })

    it('handles single key', () => {
      const config = createAuthConfig('single-key')
      expect(config.teamApiKeys).toEqual(['single-key'])
    })
  })

  describe('validateToken', () => {
    const config = createAuthConfig('key-a,key-b')

    it('accepts valid token', () => {
      expect(validateToken(config, 'key-a')).toBe(true)
      expect(validateToken(config, 'key-b')).toBe(true)
    })

    it('rejects invalid token', () => {
      expect(validateToken(config, 'key-c')).toBe(false)
      expect(validateToken(config, '')).toBe(false)
    })
  })

  describe('extractBearerToken', () => {
    it('extracts token from Bearer header', () => {
      expect(extractBearerToken('Bearer abc123')).toBe('abc123')
    })

    it('is case insensitive', () => {
      expect(extractBearerToken('bearer abc123')).toBe('abc123')
    })

    it('returns null for missing header', () => {
      expect(extractBearerToken(undefined)).toBeNull()
    })

    it('returns null for non-Bearer header', () => {
      expect(extractBearerToken('Basic abc123')).toBeNull()
    })
  })
})
