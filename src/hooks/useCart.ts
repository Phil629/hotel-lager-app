import { useState } from 'react';
import type { Product, Supplier } from '../types';

export interface CartItem {
  product: Product;
  quantity: number;
}

export const useCart = (suppliers: Supplier[]) => {
  const [orderCart, setOrderCart] = useState<CartItem[]>([]);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [isOrderEmailExpanded, setIsOrderEmailExpanded] = useState(false);

  const generateEmailTemplate = (cart: CartItem[]) => {
    if (cart.length === 0) return { subject: '', body: '' };
    const mainProduct = cart[0].product;
    const supplier = suppliers.find(s => s.id === mainProduct.supplierId);

    let subject = mainProduct.emailOrderSubject || supplier?.emailSubjectTemplate || `Bestellung: {product_name}`;
    let body = mainProduct.emailOrderBody || supplier?.emailBodyTemplate || `Sehr geehrte Damen und Herren,\n\nbitte liefern Sie {quantity}x {product_name} ({unit}).\n\nMit freundlichen Grüßen\nEinkauf`;

    const productList = cart.map(c => `- ${c.quantity}x ${c.product.name}`).join('\n');

    if (cart.length === 1) {
      subject = subject
        .replace(/{product_name}/g, mainProduct.name)
        .replace(/{quantity}/g, cart[0].quantity.toString())
        .replace(/{unit}/g, mainProduct.unit || '');
      body = body
        .replace(/{product_name}/g, mainProduct.name)
        .replace(/{quantity}/g, cart[0].quantity.toString())
        .replace(/{unit}/g, mainProduct.unit || '')
        .replace(/{PRODUKTE}/g, `- ${cart[0].quantity}x ${mainProduct.name}`);
    } else {
      const listSubjectInfo = cart.length + ' Produkte';
      const listBodyInfo = '\n' + cart.map(c => `- ${c.quantity}x ${c.product.name}`).join('\n');
      subject = subject.replace(/{quantity}x?\s*{product_name}(?:\s*\({unit}\))?|{product_name}/g, listSubjectInfo);
      body = body
        .replace(/{quantity}x?\s*{product_name}(?:\s*\({unit}\))?|{product_name}/g, listBodyInfo)
        .replace(/{PRODUKTE}/g, listBodyInfo);
    }

    subject = subject.replace(/\{PRODUKTE\}/g, productList);
    body = body.replace(/\{PRODUKTE\}/g, productList);

    return { subject, body };
  };

  const getEffectiveOrderMethod = (product: Product) => {
    if (product.preferredOrderMethod) return product.preferredOrderMethod;
    const supplier = suppliers.find(s => s.id === product.supplierId);
    return supplier?.preferredOrderMethod || 'email';
  };

  const handleProductSelect = (product: Product) => {
    const initialCart: CartItem[] = [{ product, quantity: product.standardOrderQuantity || 1 }];
    setOrderCart(initialCart);
    setIsOrderEmailExpanded(getEffectiveOrderMethod(product) === 'email');
    const { subject, body } = generateEmailTemplate(initialCart);
    setEmailSubject(subject);
    setEmailBody(body);
  };

  const addToCart = (product: Product) => {
    setOrderCart(prev => {
      const newCart = [...prev, { product, quantity: product.standardOrderQuantity || 1 }];
      const { subject, body } = generateEmailTemplate(newCart);
      setEmailSubject(subject);
      setEmailBody(body);
      return newCart;
    });
  };

  const updateCartQuantity = (index: number, quantity: number) => {
    setOrderCart(prev => {
      const newCart = prev.map((c, i) => i === index ? { ...c, quantity } : c);
      const { subject, body } = generateEmailTemplate(newCart);
      setEmailSubject(subject);
      setEmailBody(body);
      return newCart;
    });
  };

  const removeFromCart = (index: number) => {
    setOrderCart(prev => {
      const newCart = prev.filter((_, i) => i !== index);
      const { subject, body } = generateEmailTemplate(newCart);
      setEmailSubject(subject);
      setEmailBody(body);
      return newCart;
    });
  };

  const clearCart = () => {
    setOrderCart([]);
    setEmailSubject('');
    setEmailBody('');
  };

  return {
    orderCart,
    setOrderCart,
    emailSubject,
    emailBody,
    isOrderEmailExpanded,
    setEmailSubject,
    setEmailBody,
    setIsOrderEmailExpanded,
    handleProductSelect,
    addToCart,
    updateCartQuantity,
    removeFromCart,
    clearCart,
    generateEmailTemplate,
    getEffectiveOrderMethod,
  };
};
