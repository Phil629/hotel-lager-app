import { describe, it, expect } from 'vitest'
import {
  sanitizeSupplierEmail,
  cleanProductName,
  toSearchQueryName,
  resolveSupplierDomainHint,
  resolveWebshopDomain,
  isDeepProductUrl,
  getEffectiveSupplierNoMinStock,
  computeSuggestedMinStock,
} from './productHelpers'

describe('productHelpers', () => {
  it('sanitizes placeholder and empty supplier emails to null', () => {
    expect(sanitizeSupplierEmail(null)).toBeNull()
    expect(sanitizeSupplierEmail('')).toBeNull()
    expect(sanitizeSupplierEmail('   ')).toBeNull()
    expect(sanitizeSupplierEmail('hello@unbekannt.com')).toBeNull()
    expect(sanitizeSupplierEmail('HELLO@UNBEKANNT.COM')).toBeNull()
    expect(sanitizeSupplierEmail('  service@hygi.de  ')).toBe('service@hygi.de')
  })

  it('preserves product variants and flavors after hyphens or commas in cleanProductName', () => {
    expect(cleanProductName('Teavelope English Breakfast - Schwarzer Tee')).toBe(
      'Teavelope English Breakfast - Schwarzer Tee',
    )
    expect(cleanProductName('Coca Cola Zero - Dose 24 x 0,33 L, koffeinhaltiges Erfrischungsgetränk')).toBe(
      'Coca Cola Zero - Dose 24 x 0,33 L, koffeinhaltiges Erfrischungsgetränk',
    )
    expect(cleanProductName('50 Stück Türschild Hotel Bitte nicht stören')).toBe(
      'Türschild Hotel Bitte nicht stören (50 Stück)',
    )
    expect(cleanProductName('Zitronen Kl.I ES (500g Netz)')).toBe('Zitronen (500g Netz)')
  })

  it('shortens long hyphenated titles only in toSearchQueryName', () => {
    const longVariant = 'Teavelope English Breakfast Schwarzer Tee im Aufgussbeutel - 25 x 2g Packung Hotelbedarf'
    expect(toSearchQueryName(longVariant)).toBe('Teavelope English Breakfast Schwarzer Tee im Aufgussbeutel')
    expect(toSearchQueryName('Coca Cola 24×0,33L')).toBe('Coca Cola 24x0,33L')
  })

  it('resolves supplier domain hint from DB url/orderUrl or corporate email only', () => {
    expect(resolveSupplierDomainHint('https://www.reinigungsberater.de/shop', 'info@web.de')).toBe(
      'reinigungsberater.de',
    )
    expect(resolveSupplierDomainHint(null, 'order@lusini.com')).toBe('lusini.com')
    expect(resolveSupplierDomainHint(null, 'bestellung@gmail.com')).toBe('')
    expect(resolveSupplierDomainHint(null, 'hello@unbekannt.com')).toBe('')
  })

  it('derives webshop domain strictly from order method and DB fields (no hardcoded vendor lists)', () => {
    expect(
      resolveWebshopDomain({
        supplierUrl: 'https://www.hewo-getraenke.de',
        supplierEmail: 'bestellung@hewo.de',
        supplierOrderMethod: 'email',
      }),
    ).toBe('')

    expect(
      resolveWebshopDomain({
        supplierUrl: 'https://www.adacosmetics.de',
        supplierOrderMethod: 'phone',
      }),
    ).toBe('')

    expect(
      resolveWebshopDomain({
        supplierUrl: 'https://www.fixpart.de',
        supplierOrderMethod: 'webshop',
      }),
    ).toBe('fixpart.de')

    expect(
      resolveWebshopDomain({
        supplierEmail: 'service@meinshop-example.de',
        supplierOrderMethod: 'webshop',
        isWebshopFlag: true,
      }),
    ).toBe('meinshop-example.de')
  })

  it('distinguishes deep product URLs from homepages, search pages, and legal pages', () => {
    expect(isDeepProductUrl('https://www.hygi.de')).toBe(false)
    expect(isDeepProductUrl('https://www.lusini.com/de-de/')).toBe(false)
    expect(isDeepProductUrl('https://www.reinigungsberater.de/suche?q=reiniger')).toBe(false)
    expect(isDeepProductUrl('https://www.bueromarkt-ag.de/warenkorb')).toBe(false)
    expect(isDeepProductUrl('https://www.example.de/impressum')).toBe(false)

    expect(isDeepProductUrl('https://www.bueromarkt-ag.de/kaffeereiniger,p-12345.html')).toBe(true)
    expect(isDeepProductUrl('https://www.amazon.de/dp/B08XYZ1234')).toBe(true)
  })

  it('respects supplier defaultNoMinStock while preserving manual per-product overrides', () => {
    expect(getEffectiveSupplierNoMinStock({ selectors: { defaultNoMinStock: true } })).toBe(true)
    expect(getEffectiveSupplierNoMinStock({ default_no_min_stock: false, selectors: {} })).toBe(false)

    // Supplier default "no min stock" prevents AI/historical minStock from being forced
    expect(
      computeSuggestedMinStock({
        currentMinStock: 0,
        aiMinStock: 4,
        pastQuantitiesCount: 5,
        standardOrderQuantity: 6,
        supplierNoMinStock: true,
      }),
    ).toBe(0)

    // Manual override > 0 on individual product ALWAYS wins over supplier defaultNoMinStock
    expect(
      computeSuggestedMinStock({
        currentMinStock: 3,
        aiMinStock: 4,
        pastQuantitiesCount: 5,
        standardOrderQuantity: 6,
        supplierNoMinStock: true,
      }),
    ).toBe(3)

    // Normal supplier uses AI minStock or half of standard quantity on repeat orders
    expect(
      computeSuggestedMinStock({
        currentMinStock: 0,
        aiMinStock: 2,
        pastQuantitiesCount: 0,
        standardOrderQuantity: 4,
        supplierNoMinStock: false,
      }),
    ).toBe(2)

    expect(
      computeSuggestedMinStock({
        currentMinStock: 0,
        aiMinStock: null,
        pastQuantitiesCount: 3,
        standardOrderQuantity: 6,
        supplierNoMinStock: false,
      }),
    ).toBe(3)
  })
})
