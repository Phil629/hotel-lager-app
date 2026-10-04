import { useState, useEffect, useRef, useCallback } from 'react';
import type { Order, Product, Supplier } from '../types';
import { DataService, RECEIVED_ORDERS_PAGE_SIZE } from '../services/data';
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

/**
 * Data hook for the Orders view.
 *
 * `orders` contains ALL open orders plus one page of received orders
 * (server-side paginated + searchable). Analytics views that need the full
 * history keep using `DataService.getOrders()` directly.
 */
export const useOrderData = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [inboundEmails, setInboundEmails] = useState<InboundEmail[]>([]);

  // Received-orders pagination
  const [receivedLimit, setReceivedLimit] = useState(RECEIVED_ORDERS_PAGE_SIZE);
  const [receivedSearch, setReceivedSearch] = useState('');
  const [receivedTotal, setReceivedTotal] = useState(0);
  const [receivedLoading, setReceivedLoading] = useState(false);

  // Refs so realtime callbacks always use the current page/search
  const receivedLimitRef = useRef(receivedLimit);
  const receivedSearchRef = useRef(receivedSearch);
  receivedLimitRef.current = receivedLimit;
  receivedSearchRef.current = receivedSearch;
  const requestSeq = useRef(0);

  const rtDebounce = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const debounced = (key: string, fn: () => void, ms = 300) => {
    clearTimeout(rtDebounce.current[key]);
    rtDebounce.current[key] = setTimeout(fn, ms);
  };

  const loadOrders = useCallback(async (force = false) => {
    const seq = ++requestSeq.current;
    setReceivedLoading(true);
    try {
      const [open, received] = await Promise.all([
        DataService.getOpenOrders(force),
        DataService.getReceivedOrdersPage(
          { limit: receivedLimitRef.current, search: receivedSearchRef.current },
          force
        ),
      ]);
      // Ignore responses that were overtaken by a newer request (e.g. fast typing)
      if (seq !== requestSeq.current) return;
      const openIds = new Set(open.map(o => o.id));
      setOrders([...open, ...received.orders.filter(o => !openIds.has(o.id))]);
      setReceivedTotal(received.total);
    } catch (e) {
      console.error('loadOrders failed:', e);
    } finally {
      if (seq === requestSeq.current) setReceivedLoading(false);
    }
  }, []);

  const loadProducts = async (force = false) => {
    try {
      const data = await DataService.getProducts(force);
      setProducts(data);
    } catch (e) { console.error('loadProducts failed:', e); }
  };

  const loadSuppliers = async (force = false) => {
    try {
      const data = await DataService.getSuppliers(force);
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

  /** Loads the next page of received orders. */
  const loadMoreReceived = useCallback(() => {
    setReceivedLimit(prev => prev + RECEIVED_ORDERS_PAGE_SIZE);
  }, []);

  /** Updates the received-orders search (server-side, debounced). Resets paging. */
  const searchReceived = useCallback((term: string) => {
    setReceivedSearch(term);
    setReceivedLimit(RECEIVED_ORDERS_PAGE_SIZE);
  }, []);

  // Reload received orders when page size or search changes (search debounced)
  const isFirstPagingRun = useRef(true);
  useEffect(() => {
    if (isFirstPagingRun.current) { isFirstPagingRun.current = false; return; }
    debounced('received_paging', () => loadOrders(), receivedSearch ? 350 : 0);
  }, [receivedLimit, receivedSearch]); // eslint-disable-line react-hooks/exhaustive-deps

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
        debounced('orders', () => loadOrders(true));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, () => {
        debounced('products', () => loadProducts(true));
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'suppliers' }, () => {
        debounced('suppliers', () => loadSuppliers(true));
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
    // Received-orders pagination
    receivedTotal,
    receivedLimit,
    receivedLoading,
    receivedSearch,
    searchReceived,
    loadMoreReceived,
  };
};
