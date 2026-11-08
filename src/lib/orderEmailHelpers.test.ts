import { describe, expect, it } from 'vitest';
import type { Product, Supplier } from '../types';
import {
    buildEmailClientUrls,
    buildOrderEmailTemplate,
    resolveOrderEmailAddress,
} from './orderEmailHelpers';

const mkProduct = (overrides: Partial<Product> = {}): Product => ({
    id: 'p1',
    name: 'Selters Classic 12x0,75L',
    category: 'Getränke',
    stock: 2,
    unit: 'Kasten',
    supplierId: 'sup1',
    ...overrides,
});

const mkSupplier = (overrides: Partial<Supplier> = {}): Supplier => ({
    id: 'sup1',
    name: 'HEWO Getränke-Vertriebs-GmbH',
    email: 'info@hewo-mainz.de',
    preferredOrderMethod: 'email',
    ...overrides,
});

describe('orderEmailHelpers', () => {
    it('resolves product emailOrderAddress before supplier orderEmail and email while filtering placeholder', () => {
        expect(
            resolveOrderEmailAddress(
                mkProduct({ emailOrderAddress: 'bestellung@direkt.de' }),
                mkSupplier({ orderEmail: 'orders@hewo.de', email: 'info@hewo.de' })
            )
        ).toBe('bestellung@direkt.de');

        expect(
            resolveOrderEmailAddress(
                mkProduct({ emailOrderAddress: 'hello@unbekannt.com' }),
                mkSupplier({ orderEmail: 'orders@hewo.de', email: 'info@hewo.de' })
            )
        ).toBe('orders@hewo.de');

        expect(
            resolveOrderEmailAddress(
                mkProduct(),
                mkSupplier({ orderEmail: undefined, email: 'hello@unbekannt.com' })
            )
        ).toBe('');
    });

    it('replaces {PRODUKTE} placeholder when multiple products are added to the email order', () => {
        const supplier = mkSupplier({
            emailSubjectTemplate: 'Hotel Schottenhof Kundennummer 127',
            emailBodyTemplate: 'Sehr geehrte Damen und Herren,\nwir bestellen:\n{PRODUKTE}\n\nMit freundlichen Grüßen',
        });
        const p1 = mkProduct({ id: 'p1', name: 'Selters Classic', unit: 'Kasten' });
        const p2 = mkProduct({ id: 'p2', name: 'Apfelschorle 24x0,33L', unit: 'Kiste' });

        const { subject, body } = buildOrderEmailTemplate(
            [
                { product: p1, quantity: 4 },
                { product: p2, quantity: 2 },
            ],
            [supplier]
        );

        expect(subject).toBe('Hotel Schottenhof Kundennummer 127');
        expect(body).toContain('- 4x Selters Classic (Kasten)');
        expect(body).toContain('- 2x Apfelschorle 24x0,33L (Kiste)');
        expect(body).not.toContain('{PRODUKTE}');
    });

    it('appends product list if custom template has no {PRODUKTE} or {product_name} placeholder', () => {
        const supplier = mkSupplier({
            emailBodyTemplate: 'Hallo zusammen,\nbitte zeitnah liefern.',
        });
        const p1 = mkProduct({ id: 'p1', name: 'Vollmilch 3,5%', unit: 'Karton' });
        const p2 = mkProduct({ id: 'p2', name: 'Kaffeesahne', unit: 'Karton' });

        const { body } = buildOrderEmailTemplate(
            [
                { product: p1, quantity: 3 },
                { product: p2, quantity: 1 },
            ],
            [supplier]
        );

        expect(body).toContain('Hallo zusammen,\nbitte zeitnah liefern.');
        expect(body).toContain('- 3x Vollmilch 3,5% (Karton)');
        expect(body).toContain('- 1x Kaffeesahne (Karton)');
    });

    it('handles legacy {product_name} templates for single and multi-item carts and builds valid Gmail/mailto links', () => {
        const supplier = mkSupplier({
            emailSubjectTemplate: 'Bestellung {product_name}',
            emailBodyTemplate: 'Bitte liefern Sie {quantity}x {product_name} ({unit}).',
        });
        const p1 = mkProduct({ id: 'p1', name: 'Cola', unit: 'Kasten' });
        const p2 = mkProduct({ id: 'p2', name: 'Fanta', unit: 'Kasten' });

        const single = buildOrderEmailTemplate([{ product: p1, quantity: 2 }], [supplier]);
        expect(single.subject).toBe('Bestellung Cola');
        expect(single.body).toBe('Bitte liefern Sie 2x Cola (Kasten).');

        const multi = buildOrderEmailTemplate(
            [
                { product: p1, quantity: 2 },
                { product: p2, quantity: 3 },
            ],
            [supplier]
        );
        expect(multi.subject).toBe('Bestellung 2 Produkte');
        expect(multi.body).toContain('- 2x Cola (Kasten)');
        expect(multi.body).toContain('- 3x Fanta (Kasten)');

        const links = buildEmailClientUrls('info@hewo-mainz.de', multi.subject, multi.body);
        expect(links.gmailUrl).toContain('to=info%40hewo-mainz.de');
        expect(links.mailtoUrl.startsWith('mailto:info@hewo-mainz.de?subject=')).toBe(true);
    });
});
