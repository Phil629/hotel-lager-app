import { useState, useEffect, useRef } from 'react';
import type { Order, Product, Supplier } from '../types';
import { DataService } from '../services/data';
import { getSupabaseClient } from '../services/supabase';

interface InboundEmail {
  id: string;
  supplier_name: string;
  subject: string;
  body_text: string;
  extracted_data: Record<string, unknown> | null;
  status: string;
  created_at: string;
}

export const useOrderData = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inboundEmails, setInboundEmails] = useState<InboundEmail[]>([]);
  const rtDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const debounced = (key: string, fn: () => void, ms = 300) => {
    clearTimeout(rtDebounce.current[key]);
    rtDebounce.current[key] = setTimeout(fn, ms);
  };

  const loadOrders = async () => {
    try {
      const data = await DataService.getOrders();
      setOrders(data);
    } catch (e) { console.error('loadOrders failed:', e); }
  };

  const loadProducts = async () => {
    try {
      const data = await DataService.getProducts();
      setProducts(data);
    } catch (e) { console.error('loadProducts failed:', e); }
  };

  const loadSuppliers = async () => {
    try {
      const data = await DataService.getSuppliers();
      setSuppliers(data);
    } catch (e) { console.error('loadSuppliers failed:', e); }
  };

  const loadInboundEmails = async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return;
    const { data, error } = await supabase
      .from('inbound_emails')
      .select('id, supplier_name, subject, body_text, extracted_data, status, created_at')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) console.error('Error loading inbound emails:', error);
    if (data) setInboundEmails(data as InboundEmail[]);
  };

  useEffect(() => {
    loadOrders();
    loadProducts();
    loadSuppliers();
    loadInboundEmails();

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const channelName = `orders_rt_${Math.random().toString(36).slice(2, 8)}`;
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, () => {
        debounced('orders', loadOrders);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        debounced('products', loadProducts);
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, () => {
        debounced('suppliers', loadSuppliers);
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'inbound_emails' }, () => {
        debounced('inbound_emails', loadInboundEmails);
      })
      .subscribe();

    return () => {
      Object.values(rtDebounce.current).forEach(clearTimeout);
      supabase.removeChannel(channel);
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    orders,
    setOrders,
    products,
    setProducts,
    suppliers,
    setSuppliers,
    inboundEmails,
    loadOrders,
    loadProducts,
    loadSuppliers,
  };
};
