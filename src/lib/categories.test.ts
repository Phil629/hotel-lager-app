import { describe, it, expect } from 'vitest'
import { STANDARD_CATEGORIES, normalizeCategory } from './categories'

describe('categories normalization', () => {
  it('excludes redundant synonym categories from canonical STANDARD_CATEGORIES', () => {
    expect(STANDARD_CATEGORIES).not.toContain('Hotelbedarf')
    expect(STANDARD_CATEGORIES).not.toContain('Gastronomiebedarf')
    expect(STANDARD_CATEGORIES).not.toContain('Technik')
    expect(STANDARD_CATEGORIES).toContain('Hotel & Gastro')
    expect(STANDARD_CATEGORIES).toContain('Instandhaltung')
  })

  it('maps synonyms, strips placeholder categories, and preserves custom hotel categories', () => {
    expect(normalizeCategory('Büro')).toBe('Bürobedarf')
    expect(normalizeCategory('Technik')).toBe('Instandhaltung')
    expect(normalizeCategory('Hotelbedarf')).toBe('Hotel & Gastro')
    expect(normalizeCategory('Gastronomiebedarf')).toBe('Hotel & Gastro')
    expect(normalizeCategory('Reinigungsmittel')).toBe('Reinigung')
    expect(normalizeCategory('Hygieneartikel')).toBe('Hygiene')
    expect(normalizeCategory('getränke')).toBe('Getränke')

    expect(normalizeCategory('Ohne Kategorie')).toBe('')
    expect(normalizeCategory('Importiert')).toBe('')
    expect(normalizeCategory(null)).toBe('')

    expect(normalizeCategory('Sauna & Wellness')).toBe('Sauna & Wellness')
    expect(normalizeCategory('büro', ['Büro'])).toBe('Büro')
  })
})
