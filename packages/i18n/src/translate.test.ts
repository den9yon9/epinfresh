import { describe, expect, test } from 'bun:test'

import { translate } from './translate'

describe('translate', () => {
  test('returns the english source for the en locale', () => {
    expect(translate('en', 'Order not found')).toBe('Order not found')
  })

  test('returns the zh-CN translation when catalogued', () => {
    expect(translate('zh-CN', 'Order not found')).toBe('订单不存在')
  })

  test('falls back to the english source when uncatalogued', () => {
    expect(translate('zh-CN', 'Not a catalogued sentence')).toBe('Not a catalogued sentence')
  })

  test('interpolates {placeholder} params', () => {
    expect(translate('zh-CN', 'Hello, {name}!', { name: '小明' })).toBe('你好，小明！')
    expect(translate('en', 'Hello, {name}!', { name: 'Sam' })).toBe('Hello, Sam!')
  })
})
