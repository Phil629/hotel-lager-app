import { useCallback, useState, type SetStateAction } from 'react';
import type { Product, Supplier } from '../types';
import { buildOrderEmailTemplate, type OrderCartItem } from '../lib/orderEmailHelpers';

export type CartItem = OrderCartItem;

interface CartState {
  orderCart: CartItem[];
  emailSubject: string;
  emailBody: string;
}

const EMPTY_CART_STATE: CartState = {
  orderCart: [],
  emailSubject: '',
  emailBody: '',
};

export const useCart = (suppliers: Supplier[]) => {
  const [cartState, setCartState] = useState<CartState>(EMPTY_CART_STATE);
  const [isOrderEmailExpanded, setIsOrderEmailExpanded] = useState(false);

  const generateEmailTemplate = useCallback(
    (cart: CartItem[]) => buildOrderEmailTemplate(cart, suppliers),
    [suppliers]
  );

  const getEffectiveOrderMethod = useCallback(
    (product: Product) => {
      if (product.preferredOrderMethod) return product.preferredOrderMethod;
      const supplier = suppliers.find(s => s.id === product.supplierId);
      return supplier?.preferredOrderMethod || 'email';
    },
    [suppliers]
  );

  const setOrderCart = useCallback(
    (next: SetStateAction<CartItem[]>) => {
      setCartState(prev => {
        const nextCart = typeof next === 'function' ? next(prev.orderCart) : next;
        const { subject, body } = buildOrderEmailTemplate(nextCart, suppliers);
        return {
          orderCart: nextCart,
          emailSubject: subject,
          emailBody: body,
        };
      });
    },
    [suppliers]
  );

  const setEmailSubject = useCallback((next: SetStateAction<string>) => {
    setCartState(prev => ({
      ...prev,
      emailSubject: typeof next === 'function' ? next(prev.emailSubject) : next,
    }));
  }, []);

  const setEmailBody = useCallback((next: SetStateAction<string>) => {
    setCartState(prev => ({
      ...prev,
      emailBody: typeof next === 'function' ? next(prev.emailBody) : next,
    }));
  }, []);

  const handleProductSelect = useCallback(
    (product: Product) => {
      const initialCart: CartItem[] = [{ product, quantity: product.standardOrderQuantity || 1 }];
      const { subject, body } = buildOrderEmailTemplate(initialCart, suppliers);
      setCartState({
        orderCart: initialCart,
        emailSubject: subject,
        emailBody: body,
      });
      setIsOrderEmailExpanded(getEffectiveOrderMethod(product) === 'email');
    },
    [getEffectiveOrderMethod, suppliers]
  );

  const addToCart = useCallback(
    (product: Product) => {
      setCartState(prev => {
        if (prev.orderCart.some(c => c.product.id === product.id)) return prev;
        const nextCart = [...prev.orderCart, { product, quantity: product.standardOrderQuantity || 1 }];
        const { subject, body } = buildOrderEmailTemplate(nextCart, suppliers);
        return {
          orderCart: nextCart,
          emailSubject: subject,
          emailBody: body,
        };
      });
    },
    [suppliers]
  );

  const updateCartQuantity = useCallback(
    (index: number, quantity: number) => {
      setCartState(prev => {
        const nextCart = prev.orderCart.map((c, i) => (i === index ? { ...c, quantity } : c));
        const { subject, body } = buildOrderEmailTemplate(nextCart, suppliers);
        return {
          orderCart: nextCart,
          emailSubject: subject,
          emailBody: body,
        };
      });
    },
    [suppliers]
  );

  const removeFromCart = useCallback(
    (index: number) => {
      setCartState(prev => {
        const nextCart = prev.orderCart.filter((_, i) => i !== index);
        const { subject, body } = buildOrderEmailTemplate(nextCart, suppliers);
        return {
          orderCart: nextCart,
          emailSubject: subject,
          emailBody: body,
        };
      });
    },
    [suppliers]
  );

  const clearCart = useCallback(() => {
    setCartState(EMPTY_CART_STATE);
  }, []);

  return {
    orderCart: cartState.orderCart,
    setOrderCart,
    emailSubject: cartState.emailSubject,
    emailBody: cartState.emailBody,
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
