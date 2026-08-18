import { describe, expect, test } from 'bun:test'

import { generateRsaKeyPair } from '../wechat/crypto'
import { alipayTimestamp, buildAlipaySignContent, rsa2Sign, rsa2Verify } from './crypto'

describe('buildAlipaySignContent', () => {
  test('sorts params by key and joins with &', () => {
    const content = buildAlipaySignContent({
      b: '2',
      a: '1',
      c: '3',
    })
    expect(content).toBe('a=1&b=2&c=3')
  })

  test('excludes sign and sign_type and blank values', () => {
    const content = buildAlipaySignContent({
      app_id: 'x',
      sign: 'fake-sign',
      sign_type: 'RSA2',
      blank: '',
      method: 'alipay.trade.query',
    })
    expect(content).toBe('app_id=x&method=alipay.trade.query')
  })
})

describe('rsa2 sign/verify', () => {
  const keys = generateRsaKeyPair()
  const content = 'a=1&b=2'

  test('round trips with the matching public key', () => {
    const signature = rsa2Sign(content, keys.privateKey)
    expect(rsa2Verify(content, signature, keys.publicKey)).toBe(true)
  })

  test('rejects a signature from a different key', () => {
    const other = generateRsaKeyPair()
    const signature = rsa2Sign(content, other.privateKey)
    expect(rsa2Verify(content, signature, keys.publicKey)).toBe(false)
  })

  test('rejects garbage signatures', () => {
    expect(rsa2Verify(content, 'not-a-signature', keys.publicKey)).toBe(false)
  })
})

describe('alipayTimestamp', () => {
  test('formats as yyyy-MM-dd HH:mm:ss', () => {
    const stamp = alipayTimestamp(new Date(2026, 7, 18, 9, 5, 3))
    expect(stamp).toBe('2026-08-18 09:05:03')
  })
})
