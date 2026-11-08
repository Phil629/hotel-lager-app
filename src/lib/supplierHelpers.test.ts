import { describe, it, expect } from 'vitest'
import {
  sanitizeSupplierEmail,
  isDeepProductUrl,
  isSupplierWebshop,
  isSupplierNaturallyComplete,
} from './supplierHelpers'

describe('supplierHelpers', () => {
  it('treats placeholder hello@unbekannt.com as empty', () => {
    expect(sanitizeSupplierEmail('hello@unbekannt.com')).toBe('')
    expect(sanitizeSupplierEmail('  HELLO@UNBEKANNT.COM  ')).toBe('')
    expect(sanitizeSupplierEmail('info@lusini.com')).toBe('info@lusini.com')
    expect(sanitizeSupplierEmail(undefined)).toBe('')
  })

  it('determines webshop status purely from supplier/product order methods and URLs', () => {
    expect(
      isSupplierWebshop(
        { preferredOrderMethod: 'email', url: 'https://www.hewo.de' },
        { preferredOrderMethod: undefined, orderUrl: undefined },
      ),
    ).toBe(false)

    expect(
      isSupplierWebshop(
        { preferredOrderMethod: 'phone', url: 'https://www.adacosmetics.de' },
        { preferredOrderMethod: undefined, orderUrl: undefined },
      ),
    ).toBe(false)

    expect(
      isSupplierWebshop(
        { preferredOrderMethod: undefined, url: 'https://www.fixpart.de' },
        { preferredOrderMethod: undefined, orderUrl: undefined },
      ),
    ).toBe(true)

    expect(
      isSupplierWebshop(
        { preferredOrderMethod: 'email', url: undefined },
        { preferredOrderMethod: 'webshop', orderUrl: 'https://www.hygi.de/item-123' },
      ),
    ).toBe(true)

    expect(isDeepProductUrl('https://www.hygi.de/item-123')).toBe(true)
    expect(isDeepProductUrl('https://www.hygi.de/')).toBe(false)
  })

  it('evaluates natural completeness accurately per order method', () => {
    // Phone supplier doesn't require email or website
    expect(
      isSupplierNaturallyComplete({
        preferredOrderMethod: 'phone',
        phone: '+49 800 123456',
        defaultCategory: 'Hygiene',
      }),
    ).toBe(true)

    // Email supplier requires valid (non-placeholder) email + category, not website
    expect(
      isSupplierNaturallyComplete({
        preferredOrderMethod: 'email',
        email: 'hello@unbekannt.com',
        defaultCategory: 'Getränke',
      }),
    ).toBe(false)

    expect(
      isSupplierNaturallyComplete({
        preferredOrderMethod: 'email',
        email: 'bestellung@hewo.de',
        defaultCategory: 'Getränke',
      }),
    ).toBe(true)

    // Webshop supplier requires URL/orderUrl + category, even without email
    expect(
      isSupplierNaturallyComplete({
        preferredOrderMethod: 'webshop',
        url: 'https://www.amazon.de',
        email: 'hello@unbekannt.com',
        defaultCategory: 'Bürobedarf',
      }),
    ).toBe(true)

    // Unset order method remains incomplete even if URL & email exist
    expect(
      isSupplierNaturallyComplete({
        preferredOrderMethod: undefined,
        url: 'https://www.lusini.com',
        email: 'service@lusini.com',
        defaultCategory: 'Hotel & Gastro',
      }),
    ).toBe(false)
  })
})
