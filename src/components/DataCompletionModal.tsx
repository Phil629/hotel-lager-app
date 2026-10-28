import React, { useState, useEffect, useMemo } from 'react';
import { Sparkles, X, CheckSquare, Square, RefreshCw, AlertTriangle, CheckCircle2, ExternalLink, Image as ImageIcon, Package, Building2, Check } from 'lucide-react';
import { supabase } from '../services/supabase';
import type { Product, Supplier } from '../types';

interface DataCompletionModalProps {
    isOpen: boolean;
    onClose: () => void;
    products: Product[];
    suppliers: Supplier[];
    initialTab?: 'products' | 'suppliers';
    onSaved: (summaryMsg: string) => void;
}

interface ProductDraft {
    id: string;
    name: string;
    category: string;
    unit: string;
    price: number;
    productNumber: string;
    supplierId: string;
    orderUrl: string;
    image: string;
    preferredOrderMethod?: string;
    alternatives: string[];
    aiSuggested?: boolean;
    loadingRow?: boolean;
}

interface SupplierDraft {
    id: string;
    name: string;
    email: string;
    phone: string;
    url: string;
    customerNumber: string;
    preferredOrderMethod?: string;
    aiSuggested?: boolean;
}

const CATEGORIES = ['Lebensmittel', 'Getränke', 'Reinigung', 'Bürobedarf', 'Hygiene', 'Wasserfilter', 'Sonstiges'];
const PAGE_SIZE = 8;

export const DataCompletionModal: React.FC<DataCompletionModalProps> = ({
    isOpen,
    onClose,
    products,
    suppliers,
    initialTab = 'products',
    onSaved
}) => {
    const [activeTab, setActiveTab] = useState<'products' | 'suppliers'>(initialTab);
    const [showCompleted, setShowCompleted] = useState(false);
    const [loadingState, setLoadingState] = useState(false);
    const [aiLoading, setAiLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savingRowId, setSavingRowId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    const [completedProductIds, setCompletedProductIds] = useState<Set<string>>(new Set());
    const [completedSupplierIds, setCompletedSupplierIds] = useState<Set<string>>(new Set());

    const [productDrafts, setProductDrafts] = useState<Record<string, ProductDraft>>({});
    const [supplierDrafts, setSupplierDrafts] = useState<Record<string, SupplierDraft>>({});

    const [selectedProductIds, setSelectedProductIds] = useState<Set<string>>(new Set());
    const [selectedSupplierIds, setSelectedSupplierIds] = useState<Set<string>>(new Set());

    const [productPage, setProductPage] = useState(0);
    const [supplierPage, setSupplierPage] = useState(0);

    useEffect(() => {
        if (isOpen) {
            setActiveTab(initialTab);
            setProductPage(0);
            setSupplierPage(0);
            initDraftsAndState();
        }
    }, [isOpen, initialTab, products, suppliers]);

    const isProductNaturallyComplete = (p: Product): boolean => {
        const hasImage = !!(p.image && p.image.trim());
        const hasSupplier = !!p.supplierId;
        const hasOrderLinkOrNonWebMethod =
            !!(p.orderUrl && p.orderUrl.trim()) ||
            p.preferredOrderMethod === 'email' ||
            p.preferredOrderMethod === 'phone';
        const hasCategory = !!(p.category && p.category !== 'Sonstiges' && p.category !== 'Ohne Kategorie');
        return hasImage && hasSupplier && hasOrderLinkOrNonWebMethod && hasCategory;
    };

    const isSupplierNaturallyComplete = (s: Supplier): boolean => {
        const hasValidEmail = !!(s.email && s.email.trim() && s.email !== 'hello@unbekannt.com');
        const hasUrl = !!((s.url && s.url.trim()) || (s.orderUrl && s.orderUrl.trim()));
        const hasPhone = !!(s.phone && s.phone.trim());
        return hasValidEmail && hasUrl && hasPhone;
    };

    const initDraftsAndState = async () => {
        const pDrafts: Record<string, ProductDraft> = {};
        for (const p of products) {
            pDrafts[p.id] = {
                id: p.id,
                name: p.name || '',
                category: p.category || 'Sonstiges',
                unit: p.unit || 'Stück',
                price: p.price || 0,
                productNumber: p.productNumber || '',
                supplierId: p.supplierId || '',
                orderUrl: p.orderUrl || '',
                image: p.image || '',
                preferredOrderMethod: p.preferredOrderMethod,
                alternatives: p.image ? [p.image] : []
            };
        }
        setProductDrafts(pDrafts);

        const sDrafts: Record<string, SupplierDraft> = {};
        for (const s of suppliers) {
            sDrafts[s.id] = {
                id: s.id,
                name: s.name || '',
                email: s.email && s.email !== 'hello@unbekannt.com' ? s.email : '',
                phone: s.phone || '',
                url: s.url || s.orderUrl || '',
                customerNumber: s.customerNumber || '',
                preferredOrderMethod: s.preferredOrderMethod
            };
        }
        setSupplierDrafts(sDrafts);

        if (!supabase) return;
        setLoadingState(true);
        setError(null);
        try {
            const { data } = await supabase.functions.invoke('process-inbound-mail', {
                body: { action: 'get_completion_state' }
            });
            const cProds = new Set<string>(Array.isArray(data?.completedProductIds) ? data.completedProductIds : []);
            const cSups = new Set<string>(Array.isArray(data?.completedSupplierIds) ? data.completedSupplierIds : []);
            setCompletedProductIds(cProds);
            setCompletedSupplierIds(cSups);
        } catch (e) {
            console.warn('Could not load completion state:', e);
        } finally {
            setLoadingState(false);
        }
    };

    const filteredProducts = useMemo(() => {
        return products.filter(p => {
            const isMarkedDone = completedProductIds.has(p.id) || isProductNaturallyComplete(p);
            return showCompleted ? true : !isMarkedDone;
        });
    }, [products, completedProductIds, showCompleted]);

    const filteredSuppliers = useMemo(() => {
        return suppliers.filter(s => {
            const isMarkedDone = completedSupplierIds.has(s.id) || isSupplierNaturallyComplete(s);
            return showCompleted ? true : !isMarkedDone;
        });
    }, [suppliers, completedSupplierIds, showCompleted]);

    const pagedProducts = useMemo(() => {
        const start = productPage * PAGE_SIZE;
        return filteredProducts.slice(start, start + PAGE_SIZE);
    }, [filteredProducts, productPage]);

    const pagedSuppliers = useMemo(() => {
        const start = supplierPage * PAGE_SIZE;
        return filteredSuppliers.slice(start, start + PAGE_SIZE);
    }, [filteredSuppliers, supplierPage]);

    // Sobald eine neue Seite von Einträgen geöffnet wird, wähle die sichtbaren standardmäßig aus
    useEffect(() => {
        setSelectedProductIds(new Set(pagedProducts.map(p => p.id)));
    }, [productPage, filteredProducts.length, showCompleted]);

    useEffect(() => {
        setSelectedSupplierIds(new Set(pagedSuppliers.map(s => s.id)));
    }, [supplierPage, filteredSuppliers.length, showCompleted]);

    const fetchAiSuggestionsForVisible = async () => {
        if (!supabase || aiLoading) return;
        setAiLoading(true);
        setError(null);
        try {
            if (activeTab === 'products') {
                const itemsPayload = pagedProducts.map(p => {
                    const d = productDrafts[p.id];
                    const sup = suppliers.find(s => s.id === (d?.supplierId || p.supplierId));
                    return {
                        id: p.id,
                        type: 'product',
                        name: d?.name || p.name,
                        productNumber: d?.productNumber || p.productNumber || '',
                        category: d?.category || p.category || '',
                        unit: d?.unit || p.unit || '',
                        image: d?.image || '',
                        orderUrl: d?.orderUrl || '',
                        supplierName: sup?.name || '',
                        supplierUrl: sup?.url || sup?.orderUrl || '',
                        supplierEmail: sup?.email || ''
                    };
                });

                const { data, error: fnErr } = await supabase.functions.invoke('process-inbound-mail', {
                    body: { action: 'suggest_completion', items: itemsPayload }
                });
                if (fnErr) throw fnErr;
                if (data?.error) throw new Error(data.error);

                const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
                setProductDrafts(prev => {
                    const next = { ...prev };
                    for (const s of suggestions) {
                        const cur = next[s.id];
                        if (!cur) continue;
                        next[s.id] = {
                            ...cur,
                            image: cur.image || s.image || '',
                            orderUrl: cur.orderUrl || s.orderUrl || '',
                            productNumber: cur.productNumber || s.productNumber || '',
                            category: (!cur.category || cur.category === 'Sonstiges') && s.category ? s.category : cur.category,
                            unit: (!cur.unit || cur.unit === 'Stück' || cur.unit === 'Stk') && s.unit ? s.unit : cur.unit,
                            alternatives: Array.isArray(s.alternatives) && s.alternatives.length > 0 ? s.alternatives : cur.alternatives,
                            aiSuggested: true
                        };
                    }
                    return next;
                });
            } else {
                const itemsPayload = pagedSuppliers.map(s => {
                    const d = supplierDrafts[s.id];
                    return {
                        id: s.id,
                        type: 'supplier',
                        name: d?.name || s.name,
                        email: d?.email || s.email || '',
                        phone: d?.phone || s.phone || '',
                        url: d?.url || s.url || s.orderUrl || '',
                        customerNumber: d?.customerNumber || s.customerNumber || ''
                    };
                });

                const { data, error: fnErr } = await supabase.functions.invoke('process-inbound-mail', {
                    body: { action: 'suggest_completion', items: itemsPayload }
                });
                if (fnErr) throw fnErr;
                if (data?.error) throw new Error(data.error);

                const suggestions = Array.isArray(data?.suggestions) ? data.suggestions : [];
                setSupplierDrafts(prev => {
                    const next = { ...prev };
                    for (const s of suggestions) {
                        const cur = next[s.id];
                        if (!cur) continue;
                        next[s.id] = {
                            ...cur,
                            url: cur.url || s.url || '',
                            email: cur.email || s.email || '',
                            phone: cur.phone || s.phone || '',
                            customerNumber: cur.customerNumber || s.customerNumber || '',
                            aiSuggested: true
                        };
                    }
                    return next;
                });
            }
        } catch (err: any) {
            console.error('AI suggestion error:', err);
            setError(err?.message || 'Fehler beim Laden der KI-Vorschläge.');
        } finally {
            setAiLoading(false);
        }
    };

    const handleExtractFromOrderUrl = async (productId: string, rawUrl: string) => {
        if (!supabase || !rawUrl.trim()) return;
        const d = productDrafts[productId];
        if (!d) return;

        setProductDrafts(prev => ({
            ...prev,
            [productId]: { ...prev[productId], loadingRow: true }
        }));

        try {
            const sup = suppliers.find(s => s.id === d.supplierId);
            const { data } = await supabase.functions.invoke('process-inbound-mail', {
                body: {
                    action: 'extract_url_metadata',
                    url: rawUrl.trim(),
                    productName: d.name,
                    supplierName: sup?.name || ''
                }
            });

            if (data?.success) {
                setProductDrafts(prev => {
                    const cur = prev[productId];
                    if (!cur) return prev;
                    return {
                        ...prev,
                        [productId]: {
                            ...cur,
                            orderUrl: data.orderUrl || cur.orderUrl,
                            image: data.image || cur.image,
                            productNumber: cur.productNumber || data.sku || '',
                            price: (!cur.price || cur.price === 0) && data.price ? data.price : cur.price,
                            supplierId: cur.supplierId || data.matchedSupplierId || '',
                            category: (!cur.category || cur.category === 'Sonstiges') && data.category ? data.category : cur.category,
                            alternatives: Array.isArray(data.alternatives) && data.alternatives.length > 0 ? data.alternatives : cur.alternatives,
                            loadingRow: false,
                            aiSuggested: true
                        }
                    };
                });
            } else {
                setProductDrafts(prev => ({
                    ...prev,
                    [productId]: { ...prev[productId], loadingRow: false }
                }));
            }
        } catch {
            setProductDrafts(prev => ({
                ...prev,
                [productId]: { ...prev[productId], loadingRow: false }
            }));
        }
    };

    const handleSingleSearchProduct = async (productId: string) => {
        if (!supabase) return;
        const d = productDrafts[productId];
        if (!d) return;

        setProductDrafts(prev => ({
            ...prev,
            [productId]: { ...prev[productId], loadingRow: true }
        }));

        try {
            const sup = suppliers.find(s => s.id === d.supplierId);
            const { data } = await supabase.functions.invoke('process-inbound-mail', {
                body: {
                    action: 'suggest_completion',
                    items: [{
                        id: productId,
                        type: 'product',
                        name: d.name,
                        productNumber: d.productNumber,
                        category: d.category,
                        unit: d.unit,
                        supplierName: sup?.name || '',
                        supplierUrl: sup?.url || sup?.orderUrl || '',
                        supplierEmail: sup?.email || ''
                    }]
                }
            });
            const s = data?.suggestions?.[0];
            if (s) {
                setProductDrafts(prev => {
                    const cur = prev[productId];
                    if (!cur) return prev;
                    return {
                        ...prev,
                        [productId]: {
                            ...cur,
                            image: s.image || cur.image,
                            orderUrl: cur.orderUrl || s.orderUrl || '',
                            productNumber: cur.productNumber || s.productNumber || '',
                            category: (!cur.category || cur.category === 'Sonstiges') && s.category ? s.category : cur.category,
                            unit: (!cur.unit || cur.unit === 'Stück' || cur.unit === 'Stk') && s.unit ? s.unit : cur.unit,
                            alternatives: Array.isArray(s.alternatives) && s.alternatives.length > 0 ? s.alternatives : cur.alternatives,
                            loadingRow: false,
                            aiSuggested: true
                        }
                    };
                });
            } else {
                setProductDrafts(prev => ({
                    ...prev,
                    [productId]: { ...prev[productId], loadingRow: false }
                }));
            }
        } catch {
            setProductDrafts(prev => ({
                ...prev,
                [productId]: { ...prev[productId], loadingRow: false }
            }));
        }
    };

    const saveProductRows = async (idsToSave: string[]) => {
        if (!supabase || idsToSave.length === 0) return;
        if (idsToSave.length === 1) setSavingRowId(idsToSave[0]);
        else setSaving(true);
        setError(null);

        try {
            const payload = idsToSave.map(id => {
                const d = productDrafts[id];
                return {
                    id,
                    name: d.name,
                    category: d.category,
                    unit: d.unit,
                    price: d.price,
                    product_number: d.productNumber,
                    supplier_id: d.supplierId || null,
                    order_url: d.orderUrl,
                    image: d.image,
                    preferred_order_method: d.orderUrl ? (d.preferredOrderMethod || 'webshop') : d.preferredOrderMethod,
                    markComplete: true
                };
            });

            const { data, error: fnErr } = await supabase.functions.invoke('process-inbound-mail', {
                body: { action: 'save_completion', products: payload }
            });
            if (fnErr) throw fnErr;
            if (data?.error) throw new Error(data.error);

            if (Array.isArray(data?.completedProductIds)) {
                setCompletedProductIds(new Set(data.completedProductIds));
            } else {
                setCompletedProductIds(prev => {
                    const next = new Set(prev);
                    idsToSave.forEach(id => next.add(id));
                    return next;
                });
            }
            onSaved(`${idsToSave.length} Produkt(e) gespeichert und als vollständig markiert.`);
        } catch (err: any) {
            setError(err?.message || 'Fehler beim Speichern.');
        } finally {
            setSaving(false);
            setSavingRowId(null);
        }
    };

    const saveSupplierRows = async (idsToSave: string[]) => {
        if (!supabase || idsToSave.length === 0) return;
        if (idsToSave.length === 1) setSavingRowId(idsToSave[0]);
        else setSaving(true);
        setError(null);

        try {
            const payload = idsToSave.map(id => {
                const d = supplierDrafts[id];
                return {
                    id,
                    name: d.name,
                    email: d.email,
                    phone: d.phone,
                    url: d.url,
                    customer_number: d.customerNumber,
                    markComplete: true
                };
            });

            const { data, error: fnErr } = await supabase.functions.invoke('process-inbound-mail', {
                body: { action: 'save_completion', suppliers: payload }
            });
            if (fnErr) throw fnErr;
            if (data?.error) throw new Error(data.error);

            if (Array.isArray(data?.completedSupplierIds)) {
                setCompletedSupplierIds(new Set(data.completedSupplierIds));
            } else {
                setCompletedSupplierIds(prev => {
                    const next = new Set(prev);
                    idsToSave.forEach(id => next.add(id));
                    return next;
                });
            }
            onSaved(`${idsToSave.length} Lieferant(en) gespeichert und als vollständig markiert.`);
        } catch (err: any) {
            setError(err?.message || 'Fehler beim Speichern.');
        } finally {
            setSaving(false);
            setSavingRowId(null);
        }
    };

    if (!isOpen) return null;

    const currentPagedIds = activeTab === 'products' ? pagedProducts.map(p => p.id) : pagedSuppliers.map(s => s.id);
    const currentSelectedSet = activeTab === 'products' ? selectedProductIds : selectedSupplierIds;
    const allPageSelected = currentPagedIds.length > 0 && currentPagedIds.every(id => currentSelectedSet.has(id));

    const toggleSelectAllPage = () => {
        if (activeTab === 'products') {
            if (allPageSelected) setSelectedProductIds(new Set());
            else setSelectedProductIds(new Set(currentPagedIds));
        } else {
            if (allPageSelected) setSelectedSupplierIds(new Set());
            else setSelectedSupplierIds(new Set(currentPagedIds));
        }
    };

    const toggleSelectOne = (id: string) => {
        if (activeTab === 'products') {
            const next = new Set(selectedProductIds);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setSelectedProductIds(next);
        } else {
            const next = new Set(selectedSupplierIds);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            setSelectedSupplierIds(next);
        }
    };

    const totalPages = activeTab === 'products'
        ? Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE))
        : Math.max(1, Math.ceil(filteredSuppliers.length / PAGE_SIZE));
    const currentPage = activeTab === 'products' ? productPage : supplierPage;

    return (
        <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
            <style>{`
                @keyframes agy-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
            <div
                className="modal-box"
                style={{ maxWidth: '940px', width: '96%', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
                    <Sparkles size={18} color="var(--color-primary)" />
                    <h3 style={{ flex: 1, margin: 0 }}>Daten vervollständigen (KI-Assistent)</h3>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text-muted)', cursor: 'pointer', marginRight: '8px' }}>
                        <input
                            type="checkbox"
                            checked={showCompleted}
                            onChange={e => {
                                setShowCompleted(e.target.checked);
                                setProductPage(0);
                                setSupplierPage(0);
                            }}
                        />
                        Auch bereits erledigte anzeigen
                    </label>
                    <button className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }} onClick={onClose}>
                        <X size={16} />
                    </button>
                </div>

                {/* Tabs & KI-Button */}
                <div style={{
                    padding: '10px 20px',
                    borderBottom: '1px solid var(--color-border)',
                    backgroundColor: 'var(--color-surface-elevated)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '12px',
                    flexWrap: 'wrap'
                }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={() => setActiveTab('products')}
                            className={`btn btn-sm ${activeTab === 'products' ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <Package size={14} />
                            Produkte ({filteredProducts.length})
                        </button>
                        <button
                            type="button"
                            onClick={() => setActiveTab('suppliers')}
                            className={`btn btn-sm ${activeTab === 'suppliers' ? 'btn-primary' : 'btn-ghost'}`}
                            style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                        >
                            <Building2 size={14} />
                            Lieferanten ({filteredSuppliers.length})
                        </button>

                        {currentPagedIds.length > 0 && (
                            <button
                                type="button"
                                onClick={toggleSelectAllPage}
                                className="btn btn-sm btn-ghost"
                                style={{ display: 'flex', alignItems: 'center', gap: '6px', marginLeft: '6px' }}
                            >
                                {allPageSelected ? <CheckSquare size={15} color="var(--color-primary)" /> : <Square size={15} />}
                                {allPageSelected ? 'Alle abwählen' : 'Alle auf Seite abhaken'}
                            </button>
                        )}
                    </div>

                    {currentPagedIds.length > 0 && (
                        <button
                            type="button"
                            onClick={fetchAiSuggestionsForVisible}
                            disabled={aiLoading}
                            className="btn btn-sm btn-primary"
                            style={{ display: 'flex', alignItems: 'center', gap: '6px', backgroundColor: '#7c3aed', borderColor: '#7c3aed' }}
                        >
                            <RefreshCw size={13} style={aiLoading ? { animation: 'agy-spin 1s linear infinite' } : undefined} />
                            {aiLoading
                                ? 'KI sucht Bilder, Links & Daten…'
                                : `✨ KI-Vorschläge für diese ${currentPagedIds.length} Einträge laden`}
                        </button>
                    )}
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                    {error && (
                        <div style={{
                            padding: '12px 14px',
                            marginBottom: '12px',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: 'var(--color-danger-bg)',
                            color: 'var(--color-danger)',
                            border: '1px solid #fca5a5',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            fontSize: '13px'
                        }}>
                            <AlertTriangle size={16} />
                            <span>{error}</span>
                        </div>
                    )}

                    {loadingState ? (
                        <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                            <RefreshCw size={28} style={{ margin: '0 auto 12px', display: 'block', color: 'var(--color-primary)', animation: 'agy-spin 1s linear infinite' }} />
                            Lade unvollständige Einträge…
                        </div>
                    ) : activeTab === 'products' ? (
                        filteredProducts.length === 0 ? (
                            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                <CheckCircle2 size={36} style={{ color: 'var(--color-success)', display: 'block', margin: '0 auto 12px' }} />
                                <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>
                                    Alle Produkte sind vollständig!
                                </div>
                                <div style={{ fontSize: '13px' }}>
                                    Du kannst oben „Auch bereits erledigte anzeigen“ aktivieren, falls du abgeschlossene Produkte noch einmal bearbeiten möchtest.
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {pagedProducts.map(prod => {
                                    const d = productDrafts[prod.id];
                                    if (!d) return null;
                                    const isChecked = selectedProductIds.has(prod.id);
                                    const isRowSaving = savingRowId === prod.id;

                                    const missingBadges: string[] = [];
                                    if (!d.image) missingBadges.push('Kein Bild');
                                    if (!d.orderUrl && d.preferredOrderMethod !== 'email' && d.preferredOrderMethod !== 'phone') missingBadges.push('Kein Shop-Link');
                                    if (!d.supplierId) missingBadges.push('Kein Lieferant');

                                    return (
                                        <div
                                            key={prod.id}
                                            style={{
                                                border: isChecked ? '1.5px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                backgroundColor: isChecked ? 'rgba(37, 99, 235, 0.03)' : 'var(--color-surface)',
                                                borderRadius: 'var(--radius-md)',
                                                padding: '12px 14px',
                                                display: 'flex',
                                                gap: '12px',
                                                alignItems: 'flex-start'
                                            }}
                                        >
                                            {/* Checkbox */}
                                            <button
                                                type="button"
                                                onClick={() => toggleSelectOne(prod.id)}
                                                style={{ background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer' }}
                                                title="Auswählen"
                                            >
                                                {isChecked ? <CheckSquare size={18} color="var(--color-primary)" /> : <Square size={18} color="var(--color-text-muted)" />}
                                            </button>

                                            {/* Image Preview + Alternative Thumbnails */}
                                            <div style={{ width: '76px', flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px' }}>
                                                <div style={{
                                                    width: '68px',
                                                    height: '68px',
                                                    borderRadius: 'var(--radius-sm)',
                                                    border: '1px solid var(--color-border)',
                                                    backgroundColor: 'var(--color-surface-elevated)',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    overflow: 'hidden',
                                                    position: 'relative'
                                                }}>
                                                    {d.loadingRow ? (
                                                        <RefreshCw size={20} style={{ color: 'var(--color-primary)', animation: 'agy-spin 1s linear infinite' }} />
                                                    ) : d.image ? (
                                                        <img
                                                            src={d.image}
                                                            alt={d.name}
                                                            style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#fff' }}
                                                            onError={() => {
                                                                const nextAlt = d.alternatives.find(a => a !== d.image);
                                                                if (nextAlt) {
                                                                    setProductDrafts(prev => ({
                                                                        ...prev,
                                                                        [prod.id]: { ...prev[prod.id], image: nextAlt }
                                                                    }));
                                                                }
                                                            }}
                                                        />
                                                    ) : (
                                                        <ImageIcon size={22} color="var(--color-text-muted)" style={{ opacity: 0.4 }} />
                                                    )}
                                                </div>

                                                {/* Alternative Mini-Thumbnails falls KI mehrere gefunden hat */}
                                                {d.alternatives && d.alternatives.length > 1 && (
                                                    <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                                        {d.alternatives.slice(0, 3).map((altUrl, idx) => (
                                                            <img
                                                                key={idx}
                                                                src={altUrl}
                                                                alt=""
                                                                onClick={() => setProductDrafts(prev => ({
                                                                    ...prev,
                                                                    [prod.id]: { ...prev[prod.id], image: altUrl }
                                                                }))}
                                                                title="Dieses Bild wählen"
                                                                style={{
                                                                    width: '20px',
                                                                    height: '20px',
                                                                    objectFit: 'cover',
                                                                    borderRadius: '3px',
                                                                    cursor: 'pointer',
                                                                    border: d.image === altUrl ? '2px solid var(--color-primary)' : '1px solid var(--color-border)'
                                                                }}
                                                            />
                                                        ))}
                                                    </div>
                                                )}

                                                <button
                                                    type="button"
                                                    onClick={() => handleSingleSearchProduct(prod.id)}
                                                    disabled={d.loadingRow}
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ fontSize: '10px', padding: '2px 6px', height: 'auto' }}
                                                    title="Bild & Shop-Link für dieses Produkt im Web suchen"
                                                >
                                                    ✨ Suchen
                                                </button>
                                            </div>

                                            {/* Editable Fields */}
                                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                {/* Row 1: Name + Status Badges */}
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                    <input
                                                        type="text"
                                                        value={d.name}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [prod.id]: { ...prev[prod.id], name: e.target.value } }))}
                                                        className="input-field"
                                                        style={{ flex: 1, minWidth: '200px', padding: '5px 8px', fontSize: '13px', fontWeight: 600 }}
                                                        placeholder="Produktname"
                                                    />
                                                    {d.aiSuggested && (
                                                        <span style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '999px', backgroundColor: '#f3e8ff', color: '#6b21a8', fontWeight: 600 }}>
                                                            ✨ KI-Vorschlag
                                                        </span>
                                                    )}
                                                    {missingBadges.map((b, i) => (
                                                        <span key={i} style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '999px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                                                            {b}
                                                        </span>
                                                    ))}
                                                </div>

                                                {/* Row 2: Lieferant, Kategorie, Artikelnr. */}
                                                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr 0.9fr', gap: '8px' }}>
                                                    <select
                                                        value={d.supplierId}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [prod.id]: { ...prev[prod.id], supplierId: e.target.value } }))}
                                                        className="input-field"
                                                        style={{ padding: '5px 8px', fontSize: '12px' }}
                                                    >
                                                        <option value="">-- Lieferant wählen --</option>
                                                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                    </select>

                                                    <select
                                                        value={d.category}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [prod.id]: { ...prev[prod.id], category: e.target.value } }))}
                                                        className="input-field"
                                                        style={{ padding: '5px 8px', fontSize: '12px' }}
                                                    >
                                                        {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                                        {!CATEGORIES.includes(d.category) && d.category && (
                                                            <option value={d.category}>{d.category}</option>
                                                        )}
                                                    </select>

                                                    <input
                                                        type="text"
                                                        value={d.productNumber}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [prod.id]: { ...prev[prod.id], productNumber: e.target.value } }))}
                                                        placeholder="Artikelnr. (opt.)"
                                                        className="input-field"
                                                        style={{ padding: '5px 8px', fontSize: '12px' }}
                                                    />
                                                </div>

                                                {/* Row 3: Shop-Link (lädt automatisch das Bild!) & Bild-URL */}
                                                <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr', gap: '8px' }}>
                                                    <div style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                                                        <input
                                                            type="url"
                                                            value={d.orderUrl}
                                                            onChange={e => setProductDrafts(prev => ({ ...prev, [prod.id]: { ...prev[prod.id], orderUrl: e.target.value } }))}
                                                            onPaste={e => {
                                                                const pasted = e.clipboardData.getData('text')?.trim();
                                                                if (pasted && /^https?:\/\//i.test(pasted)) {
                                                                    setTimeout(() => handleExtractFromOrderUrl(prod.id, pasted), 50);
                                                                }
                                                            }}
                                                            onBlur={e => {
                                                                const val = e.target.value.trim();
                                                                if (val && !d.image) {
                                                                    handleExtractFromOrderUrl(prod.id, val);
                                                                }
                                                            }}
                                                            placeholder="Shop-Link (https://... -> lädt Bild automatisch)"
                                                            className="input-field"
                                                            style={{ flex: 1, padding: '5px 8px', fontSize: '12px' }}
                                                        />
                                                        {d.orderUrl && (
                                                            <>
                                                                <button
                                                                    type="button"
                                                                    onClick={() => handleExtractFromOrderUrl(prod.id, d.orderUrl)}
                                                                    className="btn btn-ghost btn-sm"
                                                                    style={{ padding: '4px 6px' }}
                                                                    title="Bild & Daten vom Shop-Link neu laden"
                                                                >
                                                                    <ImageIcon size={13} />
                                                                </button>
                                                                <a
                                                                    href={/^https?:\/\//i.test(d.orderUrl) ? d.orderUrl : `https://${d.orderUrl}`}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="btn btn-ghost btn-sm"
                                                                    style={{ padding: '4px 6px' }}
                                                                    title="Shop-Link öffnen"
                                                                >
                                                                    <ExternalLink size={13} />
                                                                </a>
                                                            </>
                                                        )}
                                                    </div>

                                                    <input
                                                        type="url"
                                                        value={d.image}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [prod.id]: { ...prev[prod.id], image: e.target.value } }))}
                                                        placeholder="Bild-URL (oder wird automatisch gefüllt)"
                                                        className="input-field"
                                                        style={{ padding: '5px 8px', fontSize: '12px' }}
                                                    />
                                                </div>
                                            </div>

                                            {/* Direct Save & Mark Complete Button */}
                                            <button
                                                type="button"
                                                onClick={() => saveProductRows([prod.id])}
                                                disabled={isRowSaving || saving}
                                                className="btn btn-sm btn-primary"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '5px',
                                                    whiteSpace: 'nowrap',
                                                    backgroundColor: 'var(--color-success)',
                                                    borderColor: 'var(--color-success)',
                                                    alignSelf: 'center'
                                                }}
                                                title="Speichern und als vollständig abhaken (wird künftig nicht mehr als unvollständig angezeigt)"
                                            >
                                                <Check size={14} />
                                                {isRowSaving ? 'Speichert…' : 'Erledigt'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    ) : (
                        /* TAB: SUPPLIERS */
                        filteredSuppliers.length === 0 ? (
                            <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                <CheckCircle2 size={36} style={{ color: 'var(--color-success)', display: 'block', margin: '0 auto 12px' }} />
                                <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>
                                    Alle Lieferanten sind vollständig!
                                </div>
                                <div style={{ fontSize: '13px' }}>
                                    Du kannst oben „Auch bereits erledigte anzeigen“ aktivieren, falls du abgeschlossene Lieferanten noch einmal prüfen möchtest.
                                </div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                {pagedSuppliers.map(sup => {
                                    const d = supplierDrafts[sup.id];
                                    if (!d) return null;
                                    const isChecked = selectedSupplierIds.has(sup.id);
                                    const isRowSaving = savingRowId === sup.id;

                                    const missingBadges: string[] = [];
                                    if (!d.url) missingBadges.push('Keine Website');
                                    if (!d.email) missingBadges.push('Keine E-Mail');
                                    if (!d.phone) missingBadges.push('Kein Telefon');

                                    return (
                                        <div
                                            key={sup.id}
                                            style={{
                                                border: isChecked ? '1.5px solid var(--color-primary)' : '1px solid var(--color-border)',
                                                backgroundColor: isChecked ? 'rgba(37, 99, 235, 0.03)' : 'var(--color-surface)',
                                                borderRadius: 'var(--radius-md)',
                                                padding: '12px 14px',
                                                display: 'flex',
                                                gap: '12px',
                                                alignItems: 'center'
                                            }}
                                        >
                                            <button
                                                type="button"
                                                onClick={() => toggleSelectOne(sup.id)}
                                                style={{ background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer' }}
                                            >
                                                {isChecked ? <CheckSquare size={18} color="var(--color-primary)" /> : <Square size={18} color="var(--color-text-muted)" />}
                                            </button>

                                            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                    <input
                                                        type="text"
                                                        value={d.name}
                                                        onChange={e => setSupplierDrafts(prev => ({ ...prev, [sup.id]: { ...prev[sup.id], name: e.target.value } }))}
                                                        className="input-field"
                                                        style={{ flex: 1, minWidth: '180px', padding: '5px 8px', fontSize: '13px', fontWeight: 600 }}
                                                        placeholder="Lieferantenname"
                                                    />
                                                    {d.aiSuggested && (
                                                        <span style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '999px', backgroundColor: '#f3e8ff', color: '#6b21a8', fontWeight: 600 }}>
                                                            ✨ Aus E-Mails ergänzt
                                                        </span>
                                                    )}
                                                    {missingBadges.map((b, i) => (
                                                        <span key={i} style={{ fontSize: '11px', padding: '2px 7px', borderRadius: '999px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                                                            {b}
                                                        </span>
                                                    ))}
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1.2fr 0.9fr 0.8fr', gap: '8px' }}>
                                                    <input
                                                        type="url"
                                                        value={d.url}
                                                        onChange={e => setSupplierDrafts(prev => ({ ...prev, [sup.id]: { ...prev[sup.id], url: e.target.value } }))}
                                                        placeholder="Website / Shop-URL (https://...)"
                                                        className="input-field"
                                                        style={{ padding: '5px 8px', fontSize: '12px' }}
                                                    />
                                                    <input
                                                        type="email"
                                                        value={d.email}
                                                        onChange={e => setSupplierDrafts(prev => ({ ...prev, [sup.id]: { ...prev[sup.id], email: e.target.value } }))}
                                                        placeholder="Bestell-E-Mail"
                                                        className="input-field"
                                                        style={{ padding: '5px 8px', fontSize: '12px' }}
                                                    />
                                                    <input
                                                        type="tel"
                                                        value={d.phone}
                                                        onChange={e => setSupplierDrafts(prev => ({ ...prev, [sup.id]: { ...prev[sup.id], phone: e.target.value } }))}
                                                        placeholder="Telefon (opt.)"
                                                        className="input-field"
                                                        style={{ padding: '5px 8px', fontSize: '12px' }}
                                                    />
                                                    <input
                                                        type="text"
                                                        value={d.customerNumber}
                                                        onChange={e => setSupplierDrafts(prev => ({ ...prev, [sup.id]: { ...prev[sup.id], customerNumber: e.target.value } }))}
                                                        placeholder="Kundennr. (opt.)"
                                                        className="input-field"
                                                        style={{ padding: '5px 8px', fontSize: '12px' }}
                                                    />
                                                </div>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={() => saveSupplierRows([sup.id])}
                                                disabled={isRowSaving || saving}
                                                className="btn btn-sm btn-primary"
                                                style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '5px',
                                                    whiteSpace: 'nowrap',
                                                    backgroundColor: 'var(--color-success)',
                                                    borderColor: 'var(--color-success)'
                                                }}
                                                title="Speichern und als vollständig abhaken"
                                            >
                                                <Check size={14} />
                                                {isRowSaving ? 'Speichert…' : 'Erledigt'}
                                            </button>
                                        </div>
                                    );
                                })}
                            </div>
                        )
                    )}
                </div>

                {/* Footer */}
                <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button className="btn btn-ghost" onClick={onClose} disabled={saving}>
                            Schließen
                        </button>
                        {totalPages > 1 && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={currentPage === 0}
                                    onClick={() => activeTab === 'products' ? setProductPage(p => Math.max(0, p - 1)) : setSupplierPage(p => Math.max(0, p - 1))}
                                >
                                    ← Zurück
                                </button>
                                <span>Seite {currentPage + 1} von {totalPages}</span>
                                <button
                                    type="button"
                                    className="btn btn-ghost btn-sm"
                                    disabled={currentPage >= totalPages - 1}
                                    onClick={() => activeTab === 'products' ? setProductPage(p => Math.min(totalPages - 1, p + 1)) : setSupplierPage(p => Math.min(totalPages - 1, p + 1))}
                                >
                                    Weiter →
                                </button>
                            </div>
                        )}
                    </div>

                    {currentSelectedSet.size > 0 && (
                        <button
                            type="button"
                            className="btn btn-primary"
                            disabled={saving}
                            onClick={() => {
                                const ids = [...currentSelectedSet];
                                if (activeTab === 'products') saveProductRows(ids);
                                else saveSupplierRows(ids);
                            }}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                            <CheckCircle2 size={15} />
                            {saving
                                ? 'Wird gespeichert…'
                                : `Ausgewählte speichern & als vollständig abhaken (${currentSelectedSet.size})`}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
