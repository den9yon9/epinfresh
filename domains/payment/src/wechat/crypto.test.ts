import { describe, expect, test } from 'bun:test'

import {
  aesGcmDecrypt,
  aesGcmEncrypt,
  buildAuthorizationHeader,
  generateRsaKeyPair,
  signMessage,
  verifyMessage,
  verifyPlatformSignature,
} from './crypto'

describe('wechat crypto', () => {
  const merchant = generateRsaKeyPair()
  const platform = generateRsaKeyPair()
  const API_V3_KEY = '0123456789abcdef0123456789abcdef'

  test('sign/verify round-trip with matching key', () => {
    const sig = signMessage(merchant.privateKey, 'hello')
    expect(verifyMessage(merchant.publicKey, 'hello', sig)).toBe(true)
  })

  test('verify rejects tampered message or mismatched key', () => {
    const sig = signMessage(merchant.privateKey, 'hello')
    expect(verifyMessage(merchant.publicKey, 'hello!', sig)).toBe(false)
    expect(verifyMessage(platform.publicKey, 'hello', sig)).toBe(false)
  })

  test('verify rejects malformed signature / public key', () => {
    const sig = signMessage(merchant.privateKey, 'hello')
    expect(verifyMessage(merchant.publicKey, 'hello', '!!!not-base64!!!')).toBe(false)
    expect(verifyMessage('not-a-key', 'hello', sig)).toBe(false)
  })

  test('buildAuthorizationHeader signs the WeChat message format', () => {
    const method = 'POST'
    const path = '/v3/pay/transactions/native'
    const body = JSON.stringify({ foo: 'bar' })
    const nonce = 'abc123'
    const timestamp = '1700000000'
    const header = buildAuthorizationHeader({
      merchantId: 'mch-1',
      merchantSerialNo: 'serial-1',
      merchantPrivateKey: merchant.privateKey,
      method,
      canonicalUrl: path,
      body,
      timestamp,
      nonce,
    })
    expect(header).toContain('WECHATPAY2-SHA256-RSA2048')
    expect(header).toContain('mchid="mch-1"')
    expect(header).toContain('serial_no="serial-1"')

    const signature = /signature="([^"]+)"/.exec(header)?.[1]
    expect(signature).toBeDefined()
    const message = `${method}\n${path}\n${timestamp}\n${nonce}\n${body}\n`
    expect(verifyMessage(merchant.publicKey, message, signature!)).toBe(true)
  })

  test('verifyPlatformSignature accepts fresh signed callback and rejects replay', () => {
    const now = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ ok: true })
    const sig = signMessage(platform.privateKey, `${now}\nnonce-1\n${body}\n`)
    expect(
      verifyPlatformSignature({
        platformPublicKey: platform.publicKey,
        timestamp: String(now),
        nonce: 'nonce-1',
        body,
        signature: sig,
      }),
    ).toBe(true)

    // 6 分钟前的时间戳视为重放
    const old = now - 6 * 60
    const oldSig = signMessage(platform.privateKey, `${old}\nnonce-1\n${body}\n`)
    expect(
      verifyPlatformSignature({
        platformPublicKey: platform.publicKey,
        timestamp: String(old),
        nonce: 'nonce-1',
        body,
        signature: oldSig,
      }),
    ).toBe(false)
  })

  test('verifyPlatformSignature rejects tampered body', () => {
    const now = Math.floor(Date.now() / 1000)
    const body = JSON.stringify({ ok: true })
    const sig = signMessage(platform.privateKey, `${now}\nnonce-1\n${body}\n`)
    expect(
      verifyPlatformSignature({
        platformPublicKey: platform.publicKey,
        timestamp: String(now),
        nonce: 'nonce-1',
        body: JSON.stringify({ ok: false }),
        signature: sig,
      }),
    ).toBe(false)
  })

  test('aesGcmEncrypt/Decrypt round-trip with associated data', () => {
    const encrypted = aesGcmEncrypt(API_V3_KEY, '{"amount":1}', 'transaction')
    expect(encrypted.nonce).toBeTruthy()
    expect(encrypted.ciphertext).toBeTruthy()
    expect(aesGcmDecrypt(API_V3_KEY, encrypted)).toBe('{"amount":1}')
  })

  test('aesGcmDecrypt rejects wrong key or tampered ciphertext', () => {
    const encrypted = aesGcmEncrypt(API_V3_KEY, 'secret-payload', '')
    const wrongKey = 'fedcba9876543210fedcba9876543210'
    expect(() => aesGcmDecrypt(wrongKey, encrypted)).toThrow()

    const tampered = { ...encrypted, ciphertext: Buffer.from('AAAAAA').toString('base64') }
    expect(() => aesGcmDecrypt(API_V3_KEY, tampered)).toThrow()
  })

  test('aesGcmEncrypt requires 32-byte APIv3 key', () => {
    expect(() => aesGcmEncrypt('too-short', 'x', '')).toThrow()
  })
})
