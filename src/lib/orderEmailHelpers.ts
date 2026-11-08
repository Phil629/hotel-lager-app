import type { Product, Supplier } from '../types';
import { sanitizeSupplierEmail } from './supplierHelpers';

export interface OrderCartItem {
    product: Product;
    quantity: number;
}

export function resolveOrderEmailAddress(
    product?: Pick<Product, 'emailOrderAddress'> | null,
    supplier?: Pick<Supplier, 'orderEmail' | 'email'> | null
): string {
    return (
        sanitizeSupplierEmail(product?.emailOrderAddress) ||
        sanitizeSupplierEmail(supplier?.orderEmail) ||
        sanitizeSupplierEmail(supplier?.email) ||
        ''
    );
}

export function formatCartItemLine(item: OrderCartItem): string {
    const qty = Math.max(1, Number(item.quantity) || 1);
    const unit = (item.product.unit || '').trim();
    return unit ? `- ${qty}x ${item.product.name} (${unit})` : `- ${qty}x ${item.product.name}`;
}

export function buildOrderEmailTemplate(
    cart: OrderCartItem[],
    suppliers: Supplier[]
): { subject: string; body: string } {
    if (!cart || cart.length === 0) return { subject: '', body: '' };

    const mainProduct = cart[0].product;
    const supplier = suppliers.find(s => s.id === mainProduct.supplierId);

    const rawSubject =
        mainProduct.emailOrderSubject?.trim() ||
        supplier?.emailSubjectTemplate?.trim() ||
        'Bestellung: {product_name}';
    const rawBody =
        mainProduct.emailOrderBody?.trim() ||
        supplier?.emailBodyTemplate?.trim() ||
        'Sehr geehrte Damen und Herren,\n\nbitte liefern Sie:\n{PRODUKTE}\n\nMit freundlichen Grüßen\nEinkauf';

    const listSubjectInfo = cart.length === 1 ? mainProduct.name : `${cart.length} Produkte`;
    const firstQty = String(Math.max(1, Number(cart[0].quantity) || 1));
    const productList = cart.map(formatCartItemLine).join('\n');

    let subject = rawSubject
        .replace(/\{product_name\}/g, listSubjectInfo)
        .replace(/\{quantity\}/g, cart.length === 1 ? firstQty : '')
        .replace(/\{unit\}/g, cart.length === 1 ? (mainProduct.unit || '') : '')
        .replace(/\{PRODUKTE\}/g, cart.length === 1 ? mainProduct.name : listSubjectInfo)
        .replace(/\s{2,}/g, ' ')
        .trim();

    let body = rawBody;
    if (body.includes('{PRODUKTE}')) {
        body = body.replace(/\{PRODUKTE\}/g, productList);
    } else if (body.includes('{product_name}')) {
        if (cart.length === 1) {
            body = body
                .replace(/\{product_name\}/g, mainProduct.name)
                .replace(/\{quantity\}/g, firstQty)
                .replace(/\{unit\}/g, mainProduct.unit || '');
        } else {
            body = body.replace(
                /\{quantity\}x?\s*\{product_name\}(?:\s*\(\{unit\}\))?|\{product_name\}/g,
                '\n' + productList
            );
        }
    } else {
        body = `${body}\n\n${productList}`;
    }

    return { subject, body };
}

export function buildEmailClientUrls(to: string, subject: string, body: string): {
    gmailUrl: string;
    mailtoUrl: string;
} {
    const encodedTo = encodeURIComponent(to.trim());
    const encodedSubject = encodeURIComponent(subject);
    const encodedBody = encodeURIComponent(body);
    return {
        gmailUrl: `https://mail.google.com/mail/?view=cm&fs=1&to=${encodedTo}&su=${encodedSubject}&body=${encodedBody}`,
        mailtoUrl: `mailto:${to.trim()}?subject=${encodedSubject}&body=${encodedBody}`,
    };
}
