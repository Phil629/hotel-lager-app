import React, { useState, useEffect, useMemo } from 'react';
import {
    X,
    Sparkles,
    CheckCircle2,
    ExternalLink,
    Image as ImageIcon,
    Loader2,
    Building2,
    Package,
    CheckSquare,
    Square,
    RotateCcw,
    AlertCircle,
    Mail,
    Phone
} from 'lucide-react';
import type { Product, Supplier } from '../types';
import { supabase } from '../services/supabase';

interface DataCompletionModalProps {
    isOpen: boolean;
    onClose: () => void;
    products: Product[];
    suppliers: Supplier[];
    initialTab?: 'products' | 'suppliers';
    onSaved: (message: string) => void;
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
    preferredOrderMethod?: 'email' | 'webshop' | 'link' | 'phone';
    alternatives: string[];
    loadingRow?: boolean;
    aiSuggested?: boolean;
    showCustomImageInput?: boolean;
    showOptionalShopLink?: boolean;
    // Welche Felder wurden konkret von der KI vorgeschlagen?
    aiFields?: {
        image?: boolean;
        orderUrl?: boolean;
        productNumber?: boolean;
        category?: boolean;
        unit?: boolean;
    };
}

interface SupplierDraft {
    id: string;
    name: string;
    email: string;
    phone: string;
    url: string;
    customerNumber: string;
    preferredOrderMethod?: 'email' | 'webshop' | 'link' | 'phone';
    loadingRow?: boolean;
    aiSuggested?: boolean;
    aiFields?: {
        url?: boolean;
        email?: boolean;
        phone?: boolean;
        customerNumber?: boolean;
    };
}

const STANDARD_CATEGORIES = [
    'Lebensmittel',
    'Getränke',
    'Reinigung',
    'Hygiene',
    'Bürobedarf',
    'Hotelbedarf',
    'Gastronomiebedarf',
    'Technik',
    'Instandhaltung',
    'Sonstiges'
];

const KNOWN_WEBSHOP_KEYWORDS = [
    'amazon',
    'böttcher',
    'bueromarkt',
    'hygi',
    'reinigungsberater',
    'lusini',
    'papstar',
    'ronnefeldt',
    'coffee perfect',
    'porzellantreff',
    'deutsche post',
    'ada cosmetics',
    'eofficeshop',
    'tecserv',
    'gottron',
    'hamburgpapier',
    'kaeferling',
    'zoells',
    'cent direktvertrieb',
    'otto office',
    'viking',
    'metro',
    'vega',
    'gastro hero',
    'intergastro'
];

const PAGE_SIZE = 6;

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
    const [savingBulk, setSavingBulk] = useState(false);
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
        if (!isOpen) return;
        setActiveTab(initialTab);
        setProductPage(0);
        setSupplierPage(0);
        initDraftsAndState();
    }, [isOpen, initialTab, products, suppliers]);

    // Prüft, ob ein Lieferant ein echter Online-Shop ist (oder ob per E-Mail / Telefon bestellt wird)
    const isSupplierWebshop = (sup?: Supplier | null, prod?: Product | ProductDraft | null): boolean => {
        if (prod?.preferredOrderMethod === 'webshop' || prod?.preferredOrderMethod === 'link') return true;
        if (prod?.orderUrl && prod.orderUrl.trim()) return true;
        if (!sup) return false;
        if (sup.preferredOrderMethod === 'webshop' || sup.preferredOrderMethod === 'link') return true;
        if (sup.orderUrl && sup.orderUrl.trim()) return true;
        const lowerName = (sup.name || '').toLowerCase();
        if (KNOWN_WEBSHOP_KEYWORDS.some(k => lowerName.includes(k))) return true;
        const lowerUrl = (sup.url || '').toLowerCase();
        if (lowerUrl.includes('shop.') || lowerUrl.includes('store.')) return true;
        return false;
    };

    const isProductNaturallyComplete = (p: Product): boolean => {
        const hasImage = !!(p.image && p.image.trim());
        const hasSupplier = !!p.supplierId;
        const sup = suppliers.find(s => s.id === p.supplierId);
        const needsShopLink = isSupplierWebshop(sup, p);
        const hasOrderLinkOrEmailMethod = !needsShopLink || !!(p.orderUrl && p.orderUrl.trim());
        const hasCategory = !!(p.category && p.category !== 'Sonstiges' && p.category !== 'Ohne Kategorie');
        return hasImage && hasSupplier && hasOrderLinkOrEmailMethod && hasCategory;
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
                alternatives: p.image ? [p.image] : [],
                aiFields: {}
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
                preferredOrderMethod: s.preferredOrderMethod,
                aiFields: {}
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
    }, [products, suppliers, completedProductIds, showCompleted]);

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

    useEffect(() => {
        setSelectedProductIds(new Set(pagedProducts.map(p => p.id)));
    }, [productPage, filteredProducts.length, showCompleted]);

    useEffect(() => {
        setSelectedSupplierIds(new Set(pagedSuppliers.map(s => s.id)));
    }, [supplierPage, filteredSuppliers.length, showCompleted]);

    // Zurücksetzen eines einzelnen Produkts auf den Originalzustand (falls KI falsch lag)
    const revertProductDraft = (productId: string, field?: 'image' | 'orderUrl' | 'productNumber' | 'category') => {
        const orig = products.find(p => p.id === productId);
        if (!orig) return;
        setProductDrafts(prev => {
            const cur = prev[productId];
            if (!cur) return prev;
            if (!field) {
                return {
                    ...prev,
                    [productId]: {
                        id: orig.id,
                        name: orig.name || '',
                        category: orig.category || 'Sonstiges',
                        unit: orig.unit || 'Stück',
                        price: orig.price || 0,
                        productNumber: orig.productNumber || '',
                        supplierId: orig.supplierId || '',
                        orderUrl: orig.orderUrl || '',
                        image: orig.image || '',
                        preferredOrderMethod: orig.preferredOrderMethod,
                        alternatives: orig.image ? [orig.image] : [],
                        aiSuggested: false,
                        aiFields: {}
                    }
                };
            }
            const nextAiFields = { ...(cur.aiFields || {}), [field]: false };
            const anyAiLeft = Object.values(nextAiFields).some(Boolean);
            return {
                ...prev,
                [productId]: {
                    ...cur,
                    [field]: (orig as any)[field] || (field === 'category' ? 'Sonstiges' : ''),
                    aiFields: nextAiFields,
                    aiSuggested: anyAiLeft
                }
            };
        });
    };

    const revertSupplierDraft = (supplierId: string) => {
        const orig = suppliers.find(s => s.id === supplierId);
        if (!orig) return;
        setSupplierDrafts(prev => ({
            ...prev,
            [supplierId]: {
                id: orig.id,
                name: orig.name || '',
                email: orig.email && orig.email !== 'hello@unbekannt.com' ? orig.email : '',
                phone: orig.phone || '',
                url: orig.url || orig.orderUrl || '',
                customerNumber: orig.customerNumber || '',
                preferredOrderMethod: orig.preferredOrderMethod,
                aiSuggested: false,
                aiFields: {}
            }
        }));
    };

    const fetchAiSuggestionsForVisible = async () => {
        if (!supabase || aiLoading) return;
        setAiLoading(true);
        setError(null);
        try {
            if (activeTab === 'products') {
                const itemsPayload = pagedProducts.map(p => {
                    const d = productDrafts[p.id];
                    const sup = suppliers.find(s => s.id === (d?.supplierId || p.supplierId));
                    const webshop = isSupplierWebshop(sup, d || p);
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
                        supplierEmail: sup?.email || '',
                        isWebshopSupplier: webshop
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
                        const sup = suppliers.find(supItem => supItem.id === cur.supplierId);
                        const allowShopLink = isSupplierWebshop(sup, cur);

                        const newImage = !cur.image && s.image ? s.image : cur.image;
                        const newOrderUrl = allowShopLink && !cur.orderUrl && s.orderUrl ? s.orderUrl : cur.orderUrl;
                        const newProdNum = !cur.productNumber && s.productNumber ? s.productNumber : cur.productNumber;
                        const newCat = (!cur.category || cur.category === 'Sonstiges' || cur.category === 'Ohne Kategorie') && s.category && s.category !== 'Sonstiges'
                            ? s.category
                            : cur.category;

                        const aiFields = {
                            ...(cur.aiFields || {}),
                            image: !cur.image && !!s.image ? true : cur.aiFields?.image,
                            orderUrl: allowShopLink && !cur.orderUrl && !!s.orderUrl ? true : cur.aiFields?.orderUrl,
                            productNumber: !cur.productNumber && !!s.productNumber ? true : cur.aiFields?.productNumber,
                            category: (!cur.category || cur.category === 'Sonstiges' || cur.category === 'Ohne Kategorie') && !!s.category && s.category !== 'Sonstiges' ? true : cur.aiFields?.category,
                        };

                        next[s.id] = {
                            ...cur,
                            image: newImage,
                            orderUrl: newOrderUrl,
                            productNumber: newProdNum,
                            category: newCat,
                            alternatives: Array.isArray(s.alternatives) && s.alternatives.length > 0 ? s.alternatives : cur.alternatives,
                            aiFields,
                            aiSuggested: Object.values(aiFields).some(Boolean)
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
                        const aiFields = {
                            ...(cur.aiFields || {}),
                            url: !cur.url && !!s.url ? true : cur.aiFields?.url,
                            email: !cur.email && !!s.email ? true : cur.aiFields?.email,
                            phone: !cur.phone && !!s.phone ? true : cur.aiFields?.phone,
                            customerNumber: !cur.customerNumber && !!s.customerNumber ? true : cur.aiFields?.customerNumber,
                        };
                        next[s.id] = {
                            ...cur,
                            url: cur.url || s.url || '',
                            email: cur.email || s.email || '',
                            phone: cur.phone || s.phone || '',
                            customerNumber: cur.customerNumber || s.customerNumber || '',
                            aiFields,
                            aiSuggested: Object.values(aiFields).some(Boolean)
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
                    const aiFields = {
                        ...(cur.aiFields || {}),
                        image: !!data.image ? true : cur.aiFields?.image,
                        productNumber: !cur.productNumber && !!data.sku ? true : cur.aiFields?.productNumber,
                        category: (!cur.category || cur.category === 'Sonstiges') && !!data.category && data.category !== 'Sonstiges' ? true : cur.aiFields?.category,
                    };
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
                            aiFields,
                            aiSuggested: Object.values(aiFields).some(Boolean)
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
            const allowShopLink = isSupplierWebshop(sup, d);
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
                        supplierEmail: sup?.email || '',
                        isWebshopSupplier: allowShopLink
                    }]
                }
            });
            const s = data?.suggestions?.[0];
            if (s) {
                setProductDrafts(prev => {
                    const cur = prev[productId];
                    if (!cur) return prev;
                    const aiFields = {
                        ...(cur.aiFields || {}),
                        image: !!s.image ? true : cur.aiFields?.image,
                        orderUrl: allowShopLink && !cur.orderUrl && !!s.orderUrl ? true : cur.aiFields?.orderUrl,
                        productNumber: !cur.productNumber && !!s.productNumber ? true : cur.aiFields?.productNumber,
                        category: (!cur.category || cur.category === 'Sonstiges') && !!s.category && s.category !== 'Sonstiges' ? true : cur.aiFields?.category,
                    };
                    return {
                        ...prev,
                        [productId]: {
                            ...cur,
                            image: s.image || cur.image || '',
                            orderUrl: allowShopLink ? (cur.orderUrl || s.orderUrl || '') : cur.orderUrl,
                            productNumber: cur.productNumber || s.productNumber || '',
                            category: (!cur.category || cur.category === 'Sonstiges') && s.category ? s.category : cur.category,
                            alternatives: Array.isArray(s.alternatives) && s.alternatives.length > 0 ? s.alternatives : cur.alternatives,
                            loadingRow: false,
                            aiFields,
                            aiSuggested: Object.values(aiFields).some(Boolean)
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

    const saveProductRows = async (idsToSave: string[], markComplete = true) => {
        if (!supabase || idsToSave.length === 0) return;
        const payloadProducts = idsToSave.map(id => {
            const d = productDrafts[id];
            return {
                id,
                name: d.name,
                category: d.category,
                unit: d.unit,
                price: d.price,
                product_number: d.productNumber || null,
                supplier_id: d.supplierId || null,
                order_url: d.orderUrl || null,
                preferred_order_method: d.orderUrl ? 'webshop' : d.preferredOrderMethod,
                image: d.image || null,
                markComplete
            };
        });

        const { data, error: fnErr } = await supabase.functions.invoke('process-inbound-mail', {
            body: {
                action: 'save_completion',
                products: payloadProducts
            }
        });
        if (fnErr) throw fnErr;
        if (data?.error) throw new Error(data.error);

        if (markComplete) {
            setCompletedProductIds(prev => {
                const next = new Set(prev);
                idsToSave.forEach(id => next.add(id));
                return next;
            });
        }
    };

    const saveSupplierRows = async (idsToSave: string[], markComplete = true) => {
        if (!supabase || idsToSave.length === 0) return;
        const payloadSuppliers = idsToSave.map(id => {
            const d = supplierDrafts[id];
            return {
                id,
                name: d.name,
                email: d.email || 'hello@unbekannt.com',
                phone: d.phone || null,
                url: d.url || null,
                customer_number: d.customerNumber || null,
                preferred_order_method: d.preferredOrderMethod || null,
                markComplete
            };
        });

        const { data, error: fnErr } = await supabase.functions.invoke('process-inbound-mail', {
            body: {
                action: 'save_completion',
                suppliers: payloadSuppliers
            }
        });
        if (fnErr) throw fnErr;
        if (data?.error) throw new Error(data.error);

        if (markComplete) {
            setCompletedSupplierIds(prev => {
                const next = new Set(prev);
                idsToSave.forEach(id => next.add(id));
                return next;
            });
        }
    };

    const handleSaveSingleRow = async (id: string, type: 'product' | 'supplier') => {
        setSavingRowId(id);
        setError(null);
        try {
            if (type === 'product') {
                await saveProductRows([id], true);
                onSaved('Produkt gespeichert & als vollständig abgehakt.');
            } else {
                await saveSupplierRows([id], true);
                onSaved('Lieferant gespeichert & als vollständig abgehakt.');
            }
        } catch (err: any) {
            setError(err?.message || 'Fehler beim Speichern.');
        } finally {
            setSavingRowId(null);
        }
    };

    const handleUnmarkComplete = async (id: string, type: 'product' | 'supplier') => {
        if (!supabase) return;
        setSavingRowId(id);
        try {
            await supabase.functions.invoke('process-inbound-mail', {
                body: {
                    action: 'save_completion',
                    unmarkProductIds: type === 'product' ? [id] : [],
                    unmarkSupplierIds: type === 'supplier' ? [id] : []
                }
            });
            if (type === 'product') {
                setCompletedProductIds(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
            } else {
                setCompletedSupplierIds(prev => {
                    const next = new Set(prev);
                    next.delete(id);
                    return next;
                });
            }
        } finally {
            setSavingRowId(null);
        }
    };

    const handleBulkSave = async () => {
        setSavingBulk(true);
        setError(null);
        try {
            if (activeTab === 'products') {
                const ids = Array.from(selectedProductIds);
                if (ids.length === 0) return;
                await saveProductRows(ids, true);
                onSaved(`${ids.length} ${ids.length === 1 ? 'Produkt' : 'Produkte'} gespeichert & als vollständig abgehakt!`);
            } else {
                const ids = Array.from(selectedSupplierIds);
                if (ids.length === 0) return;
                await saveSupplierRows(ids, true);
                onSaved(`${ids.length} ${ids.length === 1 ? 'Lieferant' : 'Lieferanten'} gespeichert & als vollständig abgehakt!`);
            }
        } catch (err: any) {
            setError(err?.message || 'Fehler beim Speichern.');
        } finally {
            setSavingBulk(false);
        }
    };

    if (!isOpen) return null;

    const totalProductPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
    const totalSupplierPages = Math.max(1, Math.ceil(filteredSuppliers.length / PAGE_SIZE));

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(15, 23, 42, 0.65)',
                backdropFilter: 'blur(4px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1300,
                padding: '16px'
            }}
            onClick={onClose}
        >
            <div
                style={{
                    backgroundColor: 'var(--color-surface)',
                    borderRadius: '16px',
                    width: '100%',
                    maxWidth: '1080px',
                    maxHeight: '92vh',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                    border: '1px solid var(--color-border)',
                    overflow: 'hidden'
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div style={{
                    padding: '16px 24px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                    background: 'linear-gradient(135deg, rgba(37, 99, 235, 0.06) 0%, rgba(124, 58, 237, 0.06) 100%)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            width: '38px',
                            height: '38px',
                            borderRadius: '10px',
                            background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                            color: '#fff',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0
                        }}>
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                Daten vervollständigen (KI-Assistent)
                            </h3>
                            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                Fehlende Produktbilder, Kategorien, Artikelnummern und Webshop-Links gezielt prüfen & abhaken
                            </p>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text-muted)', cursor: 'pointer', userSelect: 'none' }}>
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
                        <button
                            onClick={onClose}
                            style={{
                                background: 'none',
                                border: '1px solid var(--color-border)',
                                borderRadius: '8px',
                                padding: '6px',
                                cursor: 'pointer',
                                color: 'var(--color-text-muted)',
                                display: 'flex'
                            }}
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Kompakte 3-Schritte-Erklärung: Was macht man hier & was tun, wenn die KI falsch liegt? */}
                <div style={{
                    padding: '10px 24px',
                    backgroundColor: '#f8fafc',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
                    gap: '12px',
                    fontSize: '12px',
                    color: '#334155'
                }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                        <span style={{ backgroundColor: '#ede9fe', color: '#6d28d9', fontWeight: 800, borderRadius: '50%', width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '11px' }}>1</span>
                        <div>
                            <strong style={{ color: '#0f172a' }}>KI-Vorschläge laden:</strong> Klicke rechts auf den lila Button. Die KI sucht Produktbilder, Kategorien & Shop-Links (nur bei echten Webshops, nicht bei E-Mail-Lieferanten wie HEWO/Schwälbchen).
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                        <span style={{ backgroundColor: '#ede9fe', color: '#6d28d9', fontWeight: 800, borderRadius: '50%', width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '11px' }}>2</span>
                        <div>
                            <strong style={{ color: '#0f172a' }}>Was tun, wenn die KI falsch liegt?</strong> KI-Änderungen sind <span style={{ color: '#6d28d9', fontWeight: 700 }}>lila markiert</span>. Wähle einfach ein anderes Vorschaubild, ändere das Feld oder klicke auf <strong>„↩ Verwerfen“</strong> / <strong>„✕ Bild entfernen“</strong>.
                        </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                        <span style={{ backgroundColor: '#dcfce7', color: '#15803d', fontWeight: 800, borderRadius: '50%', width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '11px' }}>3</span>
                        <div>
                            <strong style={{ color: '#0f172a' }}>Als erledigt abhaken:</strong> Passt ein Eintrag (auch wenn z.B. bei Obst kein Bild nötig ist), klicke rechts auf <strong>„✓ Speichern & Erledigt“</strong> – dann taucht er hier nicht mehr auf.
                        </div>
                    </div>
                </div>

                {/* Toolbar: Tabs + KI Action */}
                <div style={{
                    padding: '12px 24px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                    backgroundColor: 'var(--color-surface)'
                }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                        <button
                            type="button"
                            onClick={() => setActiveTab('products')}
                            style={{
                                padding: '8px 14px',
                                borderRadius: '8px',
                                border: activeTab === 'products' ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                backgroundColor: activeTab === 'products' ? 'var(--color-primary)' : 'var(--color-surface)',
                                color: activeTab === 'products' ? '#fff' : 'var(--color-text-main)',
                                fontWeight: 600,
                                fontSize: '13px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                        >
                            <Package size={15} />
                            Offene Produkte ({filteredProducts.length})
                        </button>

                        <button
                            type="button"
                            onClick={() => setActiveTab('suppliers')}
                            style={{
                                padding: '8px 14px',
                                borderRadius: '8px',
                                border: activeTab === 'suppliers' ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                                backgroundColor: activeTab === 'suppliers' ? 'var(--color-primary)' : 'var(--color-surface)',
                                color: activeTab === 'suppliers' ? '#fff' : 'var(--color-text-main)',
                                fontWeight: 600,
                                fontSize: '13px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}
                        >
                            <Building2 size={15} />
                            Offene Lieferanten ({filteredSuppliers.length})
                        </button>
                    </div>

                    <button
                        type="button"
                        onClick={fetchAiSuggestionsForVisible}
                        disabled={aiLoading || (activeTab === 'products' ? pagedProducts.length === 0 : pagedSuppliers.length === 0)}
                        style={{
                            padding: '9px 16px',
                            borderRadius: '8px',
                            border: 'none',
                            background: 'linear-gradient(135deg, #2563eb, #7c3aed)',
                            color: '#fff',
                            fontWeight: 700,
                            fontSize: '13px',
                            cursor: aiLoading ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            opacity: aiLoading ? 0.8 : 1,
                            boxShadow: '0 4px 12px rgba(124, 58, 237, 0.25)'
                        }}
                    >
                        {aiLoading ? (
                            <>
                                <Loader2 size={15} className="spin" />
                                Suche passende Produktbilder & Daten...
                            </>
                        ) : (
                            <>
                                <Sparkles size={15} />
                                ✨ Schritt 1: KI-Vorschläge für diese {activeTab === 'products' ? pagedProducts.length : pagedSuppliers.length} Einträge suchen
                            </>
                        )}
                    </button>
                </div>

                {error && (
                    <div style={{
                        margin: '12px 24px 0 24px',
                        padding: '10px 14px',
                        borderRadius: '8px',
                        backgroundColor: '#fef2f2',
                        border: '1px solid #fecaca',
                        color: '#b91c1c',
                        fontSize: '13px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px'
                    }}>
                        <AlertCircle size={16} />
                        {error}
                    </div>
                )}

                {/* Body List */}
                <div style={{
                    padding: '16px 24px',
                    overflowY: 'auto',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '14px',
                    backgroundColor: '#f8fafc'
                }}>
                    {loadingState ? (
                        <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                            <Loader2 size={28} className="spin" style={{ margin: '0 auto 12px auto' }} />
                            Lade offene Einträge...
                        </div>
                    ) : activeTab === 'products' ? (
                        pagedProducts.length === 0 ? (
                            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                <CheckCircle2 size={42} color="#16a34a" style={{ margin: '0 auto 12px auto' }} />
                                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                    Alle Produkte sind vollständig!
                                </div>
                                <p style={{ fontSize: '13px', margin: '4px 0 0 0' }}>
                                    Aktiviere oben „Auch bereits erledigte anzeigen“, falls du abgeschlossene Produkte noch einmal ansehen möchtest.
                                </p>
                            </div>
                        ) : (
                            pagedProducts.map(p => {
                                const d = productDrafts[p.id];
                                if (!d) return null;
                                const isSelected = selectedProductIds.has(p.id);
                                const isCompleted = completedProductIds.has(p.id) || isProductNaturallyComplete(p);
                                const sup = suppliers.find(s => s.id === d.supplierId);
                                const isWebshop = isSupplierWebshop(sup, d);

                                // Was hat die KI bei diesem Produkt konkret vorgeschlagen?
                                const aiSummaryParts: string[] = [];
                                if (d.aiFields?.image && d.image) aiSummaryParts.push('Neues Produktbild');
                                if (d.aiFields?.orderUrl && d.orderUrl) {
                                    let host = 'Webshop';
                                    try { host = new URL(d.orderUrl).hostname.replace(/^www\./, ''); } catch {}
                                    aiSummaryParts.push(`Shop-Link (${host})`);
                                }
                                if (d.aiFields?.category && d.category) aiSummaryParts.push(`Kategorie → „${d.category}“`);
                                if (d.aiFields?.productNumber && d.productNumber) aiSummaryParts.push(`Artikelnr. → „${d.productNumber}“`);

                                // Was fehlt diesem Produkt aktuell noch?
                                const missingParts: string[] = [];
                                if (!d.image) missingParts.push('Produktbild fehlt');
                                if (!d.supplierId) missingParts.push('Lieferant fehlt');
                                if (isWebshop && !d.orderUrl) missingParts.push('Webshop-Link fehlt');
                                if (!d.category || d.category === 'Sonstiges' || d.category === 'Ohne Kategorie') missingParts.push('Kategorie prüfen');

                                return (
                                    <div
                                        key={p.id}
                                        style={{
                                            border: d.aiSuggested
                                                ? '2px solid #8b5cf6'
                                                : isSelected
                                                    ? '1.5px solid var(--color-primary)'
                                                    : '1px solid var(--color-border)',
                                            borderRadius: '12px',
                                            padding: '14px 16px',
                                            backgroundColor: '#ffffff',
                                            boxShadow: '0 1px 3px rgba(0,0,0,0.04)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '12px'
                                        }}
                                    >
                                        {/* KI-Vorschlags-Banner (nur sichtbar, wenn die KI für dieses Produkt etwas vorgeschlagen hat) */}
                                        {d.aiSuggested && aiSummaryParts.length > 0 && (
                                            <div style={{
                                                padding: '8px 12px',
                                                borderRadius: '8px',
                                                backgroundColor: '#f5f3ff',
                                                border: '1px solid #ddd6fe',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                gap: '8px',
                                                flexWrap: 'wrap'
                                            }}>
                                                <div style={{ fontSize: '12px', color: '#5b21b6', display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap' }}>
                                                    <Sparkles size={14} />
                                                    <strong>KI-Vorschlag zum Prüfen:</strong>
                                                    <span>{aiSummaryParts.join(' · ')}</span>
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => revertProductDraft(p.id)}
                                                    style={{
                                                        padding: '4px 10px',
                                                        borderRadius: '6px',
                                                        border: '1px solid #c4b5fd',
                                                        backgroundColor: '#ffffff',
                                                        color: '#6d28d9',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '4px'
                                                    }}
                                                    title="Alle KI-Vorschläge dieser Zeile verwerfen und auf den vorherigen Stand zurücksetzen"
                                                >
                                                    <RotateCcw size={12} />
                                                    KI-Vorschlag verwerfen
                                                </button>
                                            </div>
                                        )}

                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: '24px 125px 1fr auto',
                                            gap: '16px',
                                            alignItems: 'start'
                                        }}>
                                            {/* Checkbox */}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedProductIds(prev => {
                                                        const next = new Set(prev);
                                                        if (next.has(p.id)) next.delete(p.id);
                                                        else next.add(p.id);
                                                        return next;
                                                    });
                                                }}
                                                style={{ background: 'none', border: 'none', padding: '4px 0', cursor: 'pointer', color: isSelected ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
                                                title="Für Sammel-Speicherung auswählen"
                                            >
                                                {isSelected ? <CheckSquare size={19} /> : <Square size={19} />}
                                            </button>

                                            {/* Linke Spalte: Produktbild + Alternativen + Entfernen */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'center' }}>
                                                <div style={{
                                                    width: '84px',
                                                    height: '84px',
                                                    borderRadius: '10px',
                                                    border: d.aiFields?.image ? '2px solid #8b5cf6' : '1px solid var(--color-border)',
                                                    backgroundColor: '#f8fafc',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    overflow: 'hidden',
                                                    position: 'relative'
                                                }}>
                                                    {d.loadingRow ? (
                                                        <Loader2 size={22} className="spin" color="var(--color-primary)" />
                                                    ) : d.image ? (
                                                        <>
                                                            <img
                                                                src={d.image}
                                                                alt={d.name}
                                                                style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#fff' }}
                                                                onError={(e) => {
                                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                                }}
                                                            />
                                                            {d.aiFields?.image && (
                                                                <span style={{
                                                                    position: 'absolute',
                                                                    top: '3px',
                                                                    left: '3px',
                                                                    backgroundColor: '#7c3aed',
                                                                    color: '#fff',
                                                                    fontSize: '9px',
                                                                    fontWeight: 700,
                                                                    padding: '1px 5px',
                                                                    borderRadius: '4px'
                                                                }}>
                                                                    ✨ KI
                                                                </span>
                                                            )}
                                                        </>
                                                    ) : (
                                                        <div style={{ textAlign: 'center', color: '#94a3b8', fontSize: '10px', padding: '4px' }}>
                                                            <ImageIcon size={20} style={{ margin: '0 auto 2px auto', display: 'block', opacity: 0.6 }} />
                                                            Kein Bild
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Alternative Bilder zum Durchklicken */}
                                                {d.alternatives && d.alternatives.length > 1 && (
                                                    <div style={{ width: '100%' }}>
                                                        <div style={{ fontSize: '10px', color: '#64748b', textAlign: 'center', marginBottom: '3px', fontWeight: 600 }}>
                                                            Alternativen (Klick):
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap', justifyContent: 'center' }}>
                                                            {d.alternatives.slice(0, 4).map((altUrl, idx) => (
                                                                <img
                                                                    key={idx}
                                                                    src={altUrl}
                                                                    alt="Alternative"
                                                                    onClick={() => setProductDrafts(prev => ({
                                                                        ...prev,
                                                                        [p.id]: { ...prev[p.id], image: altUrl }
                                                                    }))}
                                                                    style={{
                                                                        width: '26px',
                                                                        height: '26px',
                                                                        borderRadius: '5px',
                                                                        objectFit: 'cover',
                                                                        cursor: 'pointer',
                                                                        backgroundColor: '#fff',
                                                                        border: d.image === altUrl ? '2px solid #7c3aed' : '1px solid var(--color-border)'
                                                                    }}
                                                                    title={`Alternativbild ${idx + 1} auswählen`}
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Bild-Aktionen: Suchen & Entfernen */}
                                                <div style={{ display: 'flex', gap: '4px', width: '100%', justifyContent: 'center', flexWrap: 'wrap' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSingleSearchProduct(p.id)}
                                                        disabled={d.loadingRow}
                                                        style={{
                                                            padding: '3px 7px',
                                                            fontSize: '11px',
                                                            borderRadius: '6px',
                                                            border: '1px solid var(--color-border)',
                                                            backgroundColor: 'var(--color-surface)',
                                                            cursor: 'pointer',
                                                            color: 'var(--color-text-main)',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '3px'
                                                        }}
                                                        title="Bild für dieses Produkt neu suchen"
                                                    >
                                                        <Sparkles size={11} color="#7c3aed" /> {d.image ? 'Neu' : 'Bild suchen'}
                                                    </button>
                                                    {d.image && (
                                                        <button
                                                            type="button"
                                                            onClick={() => setProductDrafts(prev => ({
                                                                ...prev,
                                                                [p.id]: {
                                                                    ...prev[p.id],
                                                                    image: '',
                                                                    aiFields: { ...(prev[p.id].aiFields || {}), image: false }
                                                                }
                                                            }))}
                                                            style={{
                                                                padding: '3px 7px',
                                                                fontSize: '11px',
                                                                borderRadius: '6px',
                                                                border: '1px solid #fecaca',
                                                                backgroundColor: '#fef2f2',
                                                                cursor: 'pointer',
                                                                color: '#dc2626',
                                                                display: 'flex',
                                                                alignItems: 'center',
                                                                gap: '2px'
                                                            }}
                                                            title="Falsches Bild entfernen"
                                                        >
                                                            <X size={11} /> Weg
                                                        </button>
                                                    )}
                                                </div>

                                                <button
                                                    type="button"
                                                    onClick={() => setProductDrafts(prev => ({
                                                        ...prev,
                                                        [p.id]: { ...prev[p.id], showCustomImageInput: !prev[p.id].showCustomImageInput }
                                                    }))}
                                                    style={{
                                                        background: 'none',
                                                        border: 'none',
                                                        padding: 0,
                                                        fontSize: '10px',
                                                        color: '#64748b',
                                                        textDecoration: 'underline',
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    {d.showCustomImageInput ? 'Bild-URL ausblenden' : 'Eigene Bild-URL'}
                                                </button>
                                            </div>

                                            {/* Mittlere Spalte: Klar beschriftete Felder */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                {/* Zeile 1: Produktname + Status-Badges */}
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                    <input
                                                        type="text"
                                                        value={d.name}
                                                        onChange={e => setProductDrafts(prev => ({
                                                            ...prev,
                                                            [p.id]: { ...prev[p.id], name: e.target.value }
                                                        }))}
                                                        className="input-field"
                                                        style={{ flex: 1, minWidth: '220px', padding: '6px 10px', fontSize: '14px', fontWeight: 700 }}
                                                    />
                                                    {missingParts.length > 0 ? (
                                                        missingParts.map((mp, idx) => (
                                                            <span
                                                                key={idx}
                                                                style={{
                                                                    fontSize: '11px',
                                                                    padding: '3px 8px',
                                                                    borderRadius: '999px',
                                                                    backgroundColor: '#fef3c7',
                                                                    color: '#92400e',
                                                                    fontWeight: 600
                                                                }}
                                                            >
                                                                {mp}
                                                            </span>
                                                        ))
                                                    ) : (
                                                        <span style={{ fontSize: '11px', padding: '3px 8px', borderRadius: '999px', backgroundColor: '#dcfce7', color: '#166534', fontWeight: 600 }}>
                                                            ✓ Alle Angaben vorhanden
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Zeile 2: Lieferant, Kategorie, Artikelnummer (MIT KLAREN LABELS!) */}
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '10px' }}>
                                                    {/* Lieferant */}
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '3px' }}>
                                                            Lieferant
                                                        </label>
                                                        <select
                                                            value={d.supplierId}
                                                            onChange={e => setProductDrafts(prev => ({
                                                                ...prev,
                                                                [p.id]: { ...prev[p.id], supplierId: e.target.value }
                                                            }))}
                                                            className="input-field"
                                                            style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                                                        >
                                                            <option value="">-- Lieferant wählen --</option>
                                                            {suppliers.map(s => (
                                                                <option key={s.id} value={s.id}>{s.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    {/* Kategorie */}
                                                    <div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                                                            <label style={{ fontSize: '11px', fontWeight: 600, color: d.aiFields?.category ? '#6d28d9' : '#64748b' }}>
                                                                Kategorie {d.aiFields?.category && '✨ KI'}
                                                            </label>
                                                            {d.aiFields?.category && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => revertProductDraft(p.id, 'category')}
                                                                    style={{ background: 'none', border: 'none', padding: 0, fontSize: '10px', color: '#6d28d9', cursor: 'pointer', textDecoration: 'underline' }}
                                                                >
                                                                    ↩ Zurück
                                                                </button>
                                                            )}
                                                        </div>
                                                        <select
                                                            value={d.category}
                                                            onChange={e => setProductDrafts(prev => ({
                                                                ...prev,
                                                                [p.id]: { ...prev[p.id], category: e.target.value }
                                                            }))}
                                                            className="input-field"
                                                            style={{
                                                                width: '100%',
                                                                padding: '6px 10px',
                                                                fontSize: '12px',
                                                                borderColor: d.aiFields?.category ? '#8b5cf6' : undefined,
                                                                backgroundColor: d.aiFields?.category ? '#f5f3ff' : undefined
                                                            }}
                                                        >
                                                            {STANDARD_CATEGORIES.map(c => (
                                                                <option key={c} value={c}>{c}</option>
                                                            ))}
                                                            {d.category && !STANDARD_CATEGORIES.includes(d.category) && (
                                                                <option value={d.category}>{d.category}</option>
                                                            )}
                                                        </select>
                                                    </div>

                                                    {/* Artikelnummer */}
                                                    <div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                                                            <label style={{ fontSize: '11px', fontWeight: 600, color: d.aiFields?.productNumber ? '#6d28d9' : '#64748b' }}>
                                                                Artikelnummer (optional) {d.aiFields?.productNumber && '✨ KI'}
                                                            </label>
                                                            {d.aiFields?.productNumber && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => revertProductDraft(p.id, 'productNumber')}
                                                                    style={{ background: 'none', border: 'none', padding: 0, fontSize: '10px', color: '#6d28d9', cursor: 'pointer', textDecoration: 'underline' }}
                                                                >
                                                                    ↩ Löschen
                                                                </button>
                                                            )}
                                                        </div>
                                                        <input
                                                            type="text"
                                                            placeholder="z.B. aus Rechnung..."
                                                            value={d.productNumber}
                                                            onChange={e => setProductDrafts(prev => ({
                                                                ...prev,
                                                                [p.id]: { ...prev[p.id], productNumber: e.target.value }
                                                            }))}
                                                            className="input-field"
                                                            style={{
                                                                width: '100%',
                                                                padding: '6px 10px',
                                                                fontSize: '12px',
                                                                borderColor: d.aiFields?.productNumber ? '#8b5cf6' : undefined,
                                                                backgroundColor: d.aiFields?.productNumber ? '#f5f3ff' : undefined
                                                            }}
                                                        />
                                                    </div>
                                                </div>

                                                {/* Zeile 3: Bestellweg / Shop-Link (intelligent je nach Lieferant!) */}
                                                {isWebshop || d.orderUrl || d.showOptionalShopLink ? (
                                                    <div>
                                                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '3px' }}>
                                                            <label style={{ fontSize: '11px', fontWeight: 600, color: d.aiFields?.orderUrl ? '#6d28d9' : '#64748b' }}>
                                                                Direkter Webshop-Bestelllink {sup ? `(für ${sup.name})` : ''} {d.aiFields?.orderUrl && '✨ KI-Vorschlag'}
                                                            </label>
                                                            {d.orderUrl && (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setProductDrafts(prev => ({
                                                                        ...prev,
                                                                        [p.id]: {
                                                                            ...prev[p.id],
                                                                            orderUrl: '',
                                                                            aiFields: { ...(prev[p.id].aiFields || {}), orderUrl: false }
                                                                        }
                                                                    }))}
                                                                    style={{ background: 'none', border: 'none', padding: 0, fontSize: '11px', color: '#dc2626', cursor: 'pointer', fontWeight: 600 }}
                                                                >
                                                                    ✕ Falschen Link entfernen
                                                                </button>
                                                            )}
                                                        </div>
                                                        <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                                                            <input
                                                                type="url"
                                                                placeholder="https://... (Shop-Link zum Produkt – lädt beim Einfügen automatisch das Bild)"
                                                                value={d.orderUrl}
                                                                onChange={e => setProductDrafts(prev => ({
                                                                    ...prev,
                                                                    [p.id]: { ...prev[p.id], orderUrl: e.target.value }
                                                                }))}
                                                                onPaste={e => {
                                                                    const pasted = e.clipboardData?.getData('text') || '';
                                                                    if (pasted && /^https?:\/\//i.test(pasted.trim())) {
                                                                        setTimeout(() => handleExtractFromOrderUrl(p.id, pasted.trim()), 50);
                                                                    }
                                                                }}
                                                                onBlur={e => {
                                                                    const val = e.target.value.trim();
                                                                    if (val && !d.image) {
                                                                        handleExtractFromOrderUrl(p.id, val);
                                                                    }
                                                                }}
                                                                className="input-field"
                                                                style={{
                                                                    flex: 1,
                                                                    padding: '6px 10px',
                                                                    fontSize: '12px',
                                                                    borderColor: d.aiFields?.orderUrl ? '#8b5cf6' : undefined,
                                                                    backgroundColor: d.aiFields?.orderUrl ? '#f5f3ff' : undefined
                                                                }}
                                                            />
                                                            {d.orderUrl && (
                                                                <>
                                                                    <button
                                                                        type="button"
                                                                        onClick={() => handleExtractFromOrderUrl(p.id, d.orderUrl)}
                                                                        style={{
                                                                            padding: '6px 10px',
                                                                            borderRadius: '6px',
                                                                            border: '1px solid var(--color-border)',
                                                                            backgroundColor: 'var(--color-surface)',
                                                                            cursor: 'pointer',
                                                                            fontSize: '11px',
                                                                            fontWeight: 600,
                                                                            color: 'var(--color-primary)',
                                                                            whiteSpace: 'nowrap'
                                                                        }}
                                                                        title="Produktbild von diesem Link abrufen"
                                                                    >
                                                                        🖼️ Bild vom Link
                                                                    </button>
                                                                    <a
                                                                        href={/^https?:\/\//i.test(d.orderUrl) ? d.orderUrl : `https://${d.orderUrl}`}
                                                                        target="_blank"
                                                                        rel="noopener noreferrer"
                                                                        style={{
                                                                            padding: '6px 10px',
                                                                            borderRadius: '6px',
                                                                            border: '1px solid var(--color-border)',
                                                                            color: 'var(--color-text-main)',
                                                                            display: 'flex',
                                                                            alignItems: 'center',
                                                                            gap: '4px',
                                                                            fontSize: '11px',
                                                                            textDecoration: 'none',
                                                                            fontWeight: 600,
                                                                            whiteSpace: 'nowrap'
                                                                        }}
                                                                        title="Shop-Link im Browser öffnen und prüfen"
                                                                    >
                                                                        <ExternalLink size={12} /> Link prüfen
                                                                    </a>
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    <div style={{
                                                        padding: '6px 10px',
                                                        borderRadius: '8px',
                                                        backgroundColor: '#f1f5f9',
                                                        color: '#475569',
                                                        fontSize: '12px',
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center',
                                                        flexWrap: 'wrap',
                                                        gap: '8px'
                                                    }}>
                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                            {sup?.preferredOrderMethod === 'phone' ? <Phone size={13} color="#16a34a" /> : <Mail size={13} color="#2563eb" />}
                                                            Bestellung bei <strong>{sup?.name || 'diesem Lieferanten'}</strong> erfolgt per {sup?.preferredOrderMethod === 'phone' ? 'Telefon' : 'E-Mail'} – <strong>kein Shop-Link nötig</strong>.
                                                        </span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setProductDrafts(prev => ({
                                                                ...prev,
                                                                [p.id]: { ...prev[p.id], showOptionalShopLink: true }
                                                            }))}
                                                            style={{
                                                                background: 'none',
                                                                border: 'none',
                                                                padding: 0,
                                                                fontSize: '11px',
                                                                color: 'var(--color-primary)',
                                                                cursor: 'pointer',
                                                                fontWeight: 600
                                                            }}
                                                        >
                                                            + Trotzdem Shop-Link eintragen
                                                        </button>
                                                    </div>
                                                )}

                                                {/* Optional aufklappbares Feld für direkte Bild-URL */}
                                                {d.showCustomImageInput && (
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '3px' }}>
                                                            Direkte Bild-URL (optional)
                                                        </label>
                                                        <input
                                                            type="url"
                                                            placeholder="https://... (Direkter Link zu einer Bilddatei)"
                                                            value={d.image}
                                                            onChange={e => setProductDrafts(prev => ({
                                                                ...prev,
                                                                [p.id]: { ...prev[p.id], image: e.target.value }
                                                            }))}
                                                            className="input-field"
                                                            style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                                                        />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Rechte Spalte: Klare Speicher-/Abhak-Aktion */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end', justifyContent: 'center' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSaveSingleRow(p.id, 'product')}
                                                    disabled={savingRowId === p.id}
                                                    style={{
                                                        padding: '9px 14px',
                                                        borderRadius: '8px',
                                                        border: 'none',
                                                        backgroundColor: '#16a34a',
                                                        color: '#fff',
                                                        fontWeight: 700,
                                                        fontSize: '12px',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        whiteSpace: 'nowrap',
                                                        boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)'
                                                    }}
                                                    title="Speichert alle Eingaben dieser Zeile und hakt das Produkt als vollständig ab (auch wenn du z.B. kein Bild benötigst)"
                                                >
                                                    {savingRowId === p.id ? (
                                                        <Loader2 size={14} className="spin" />
                                                    ) : (
                                                        <CheckCircle2 size={14} />
                                                    )}
                                                    {d.image ? 'Speichern & Erledigt' : 'Auch ohne Bild erledigt'}
                                                </button>

                                                {isCompleted && showCompleted && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUnmarkComplete(p.id, 'product')}
                                                        style={{
                                                            padding: '4px 8px',
                                                            borderRadius: '6px',
                                                            border: '1px solid var(--color-border)',
                                                            backgroundColor: 'transparent',
                                                            color: 'var(--color-text-muted)',
                                                            fontSize: '11px',
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '4px'
                                                        }}
                                                    >
                                                        <RotateCcw size={11} /> Wieder offen
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )
                    ) : (
                        pagedSuppliers.length === 0 ? (
                            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                <CheckCircle2 size={42} color="#16a34a" style={{ margin: '0 auto 12px auto' }} />
                                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                    Alle Lieferanten sind vollständig!
                                </div>
                                <p style={{ fontSize: '13px', margin: '4px 0 0 0' }}>
                                    Aktiviere oben „Auch bereits erledigte anzeigen“, um bereits abgehakte Lieferanten einzusehen.
                                </p>
                            </div>
                        ) : (
                            pagedSuppliers.map(s => {
                                const d = supplierDrafts[s.id];
                                if (!d) return null;
                                const isSelected = selectedSupplierIds.has(s.id);
                                const isCompleted = completedSupplierIds.has(s.id) || isSupplierNaturallyComplete(s);

                                const aiSupParts: string[] = [];
                                if (d.aiFields?.url && d.url) aiSupParts.push(`Webseite (${d.url})`);
                                if (d.aiFields?.email && d.email) aiSupParts.push(`E-Mail (${d.email})`);
                                if (d.aiFields?.phone && d.phone) aiSupParts.push(`Telefon (${d.phone})`);
                                if (d.aiFields?.customerNumber && d.customerNumber) aiSupParts.push(`Kundennr. (${d.customerNumber})`);

                                return (
                                    <div
                                        key={s.id}
                                        style={{
                                            border: d.aiSuggested
                                                ? '2px solid #8b5cf6'
                                                : isSelected
                                                    ? '1.5px solid var(--color-primary)'
                                                    : '1px solid var(--color-border)',
                                            borderRadius: '12px',
                                            padding: '14px 16px',
                                            backgroundColor: '#ffffff',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '10px'
                                        }}
                                    >
                                        {d.aiSuggested && aiSupParts.length > 0 && (
                                            <div style={{
                                                padding: '8px 12px',
                                                borderRadius: '8px',
                                                backgroundColor: '#f5f3ff',
                                                border: '1px solid #ddd6fe',
                                                display: 'flex',
                                                justifyContent: 'space-between',
                                                alignItems: 'center',
                                                gap: '8px',
                                                flexWrap: 'wrap'
                                            }}>
                                                <div style={{ fontSize: '12px', color: '#5b21b6', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <Sparkles size={14} />
                                                    <strong>KI-Vorschlag aus E-Mails:</strong> {aiSupParts.join(' · ')}
                                                </div>
                                                <button
                                                    type="button"
                                                    onClick={() => revertSupplierDraft(s.id)}
                                                    style={{
                                                        padding: '4px 10px',
                                                        borderRadius: '6px',
                                                        border: '1px solid #c4b5fd',
                                                        backgroundColor: '#ffffff',
                                                        color: '#6d28d9',
                                                        fontSize: '11px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                >
                                                    ↩ KI-Vorschlag verwerfen
                                                </button>
                                            </div>
                                        )}

                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: '24px 1fr auto',
                                            gap: '14px',
                                            alignItems: 'center'
                                        }}>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedSupplierIds(prev => {
                                                        const next = new Set(prev);
                                                        if (next.has(s.id)) next.delete(s.id);
                                                        else next.add(s.id);
                                                        return next;
                                                    });
                                                }}
                                                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: isSelected ? 'var(--color-primary)' : 'var(--color-text-muted)' }}
                                            >
                                                {isSelected ? <CheckSquare size={19} /> : <Square size={19} />}
                                            </button>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                                                    <input
                                                        type="text"
                                                        value={d.name}
                                                        onChange={e => setSupplierDrafts(prev => ({
                                                            ...prev,
                                                            [s.id]: { ...prev[s.id], name: e.target.value }
                                                        }))}
                                                        className="input-field"
                                                        style={{ flex: 1, minWidth: '200px', padding: '6px 10px', fontSize: '14px', fontWeight: 700 }}
                                                    />
                                                    {!d.url && (
                                                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                                                            Webseite fehlt
                                                        </span>
                                                    )}
                                                    {!d.email && (
                                                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                                                            E-Mail fehlt
                                                        </span>
                                                    )}
                                                    {!d.phone && (
                                                        <span style={{ fontSize: '11px', padding: '2px 8px', borderRadius: '999px', backgroundColor: '#fef3c7', color: '#92400e', fontWeight: 600 }}>
                                                            Telefon fehlt
                                                        </span>
                                                    )}
                                                </div>

                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '10px' }}>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: d.aiFields?.url ? '#6d28d9' : '#64748b', marginBottom: '3px' }}>
                                                            Webseite / Shop-URL {d.aiFields?.url && '✨ KI'}
                                                        </label>
                                                        <input
                                                            type="url"
                                                            placeholder="https://www..."
                                                            value={d.url}
                                                            onChange={e => setSupplierDrafts(prev => ({
                                                                ...prev,
                                                                [s.id]: { ...prev[s.id], url: e.target.value }
                                                            }))}
                                                            className="input-field"
                                                            style={{
                                                                width: '100%',
                                                                padding: '6px 10px',
                                                                fontSize: '12px',
                                                                borderColor: d.aiFields?.url ? '#8b5cf6' : undefined,
                                                                backgroundColor: d.aiFields?.url ? '#f5f3ff' : undefined
                                                            }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: d.aiFields?.email ? '#6d28d9' : '#64748b', marginBottom: '3px' }}>
                                                            Bestell-E-Mail {d.aiFields?.email && '✨ KI'}
                                                        </label>
                                                        <input
                                                            type="email"
                                                            placeholder="bestellung@lieferant.de"
                                                            value={d.email}
                                                            onChange={e => setSupplierDrafts(prev => ({
                                                                ...prev,
                                                                [s.id]: { ...prev[s.id], email: e.target.value }
                                                            }))}
                                                            className="input-field"
                                                            style={{
                                                                width: '100%',
                                                                padding: '6px 10px',
                                                                fontSize: '12px',
                                                                borderColor: d.aiFields?.email ? '#8b5cf6' : undefined,
                                                                backgroundColor: d.aiFields?.email ? '#f5f3ff' : undefined
                                                            }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: d.aiFields?.phone ? '#6d28d9' : '#64748b', marginBottom: '3px' }}>
                                                            Telefonnummer (opt.) {d.aiFields?.phone && '✨ KI'}
                                                        </label>
                                                        <input
                                                            type="tel"
                                                            placeholder="+49..."
                                                            value={d.phone}
                                                            onChange={e => setSupplierDrafts(prev => ({
                                                                ...prev,
                                                                [s.id]: { ...prev[s.id], phone: e.target.value }
                                                            }))}
                                                            className="input-field"
                                                            style={{
                                                                width: '100%',
                                                                padding: '6px 10px',
                                                                fontSize: '12px',
                                                                borderColor: d.aiFields?.phone ? '#8b5cf6' : undefined,
                                                                backgroundColor: d.aiFields?.phone ? '#f5f3ff' : undefined
                                                            }}
                                                        />
                                                    </div>
                                                    <div>
                                                        <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: d.aiFields?.customerNumber ? '#6d28d9' : '#64748b', marginBottom: '3px' }}>
                                                            Kundennummer (opt.) {d.aiFields?.customerNumber && '✨ KI'}
                                                        </label>
                                                        <input
                                                            type="text"
                                                            placeholder="Kundennr..."
                                                            value={d.customerNumber}
                                                            onChange={e => setSupplierDrafts(prev => ({
                                                                ...prev,
                                                                [s.id]: { ...prev[s.id], customerNumber: e.target.value }
                                                            }))}
                                                            className="input-field"
                                                            style={{
                                                                width: '100%',
                                                                padding: '6px 10px',
                                                                fontSize: '12px',
                                                                borderColor: d.aiFields?.customerNumber ? '#8b5cf6' : undefined,
                                                                backgroundColor: d.aiFields?.customerNumber ? '#f5f3ff' : undefined
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', alignItems: 'flex-end' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSaveSingleRow(s.id, 'supplier')}
                                                    disabled={savingRowId === s.id}
                                                    style={{
                                                        padding: '9px 14px',
                                                        borderRadius: '8px',
                                                        border: 'none',
                                                        backgroundColor: '#16a34a',
                                                        color: '#fff',
                                                        fontWeight: 700,
                                                        fontSize: '12px',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    {savingRowId === s.id ? (
                                                        <Loader2 size={14} className="spin" />
                                                    ) : (
                                                        <CheckCircle2 size={14} />
                                                    )}
                                                    Speichern & Erledigt
                                                </button>
                                                {isCompleted && showCompleted && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUnmarkComplete(s.id, 'supplier')}
                                                        style={{
                                                            padding: '4px 8px',
                                                            borderRadius: '6px',
                                                            border: '1px solid var(--color-border)',
                                                            backgroundColor: 'transparent',
                                                            color: 'var(--color-text-muted)',
                                                            fontSize: '11px',
                                                            cursor: 'pointer'
                                                        }}
                                                    >
                                                        Wieder offen
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })
                        )
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '14px 24px',
                    borderTop: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px',
                    flexWrap: 'wrap',
                    backgroundColor: 'var(--color-surface)'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <button
                            type="button"
                            onClick={onClose}
                            className="btn btn-ghost"
                        >
                            Schließen
                        </button>

                        {activeTab === 'products' && filteredProducts.length > PAGE_SIZE && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                                <button
                                    type="button"
                                    disabled={productPage === 0}
                                    onClick={() => setProductPage(p => Math.max(0, p - 1))}
                                    className="btn btn-ghost"
                                    style={{ padding: '4px 10px', fontSize: '12px' }}
                                >
                                    ← Zurück
                                </button>
                                <span>Seite {productPage + 1} von {totalProductPages}</span>
                                <button
                                    type="button"
                                    disabled={productPage + 1 >= totalProductPages}
                                    onClick={() => setProductPage(p => Math.min(totalProductPages - 1, p + 1))}
                                    className="btn btn-ghost"
                                    style={{ padding: '4px 10px', fontSize: '12px' }}
                                >
                                    Weiter →
                                </button>
                            </div>
                        )}

                        {activeTab === 'suppliers' && filteredSuppliers.length > PAGE_SIZE && (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                                <button
                                    type="button"
                                    disabled={supplierPage === 0}
                                    onClick={() => setSupplierPage(p => Math.max(0, p - 1))}
                                    className="btn btn-ghost"
                                    style={{ padding: '4px 10px', fontSize: '12px' }}
                                >
                                    ← Zurück
                                </button>
                                <span>Seite {supplierPage + 1} von {totalSupplierPages}</span>
                                <button
                                    type="button"
                                    disabled={supplierPage + 1 >= totalSupplierPages}
                                    onClick={() => setSupplierPage(p => Math.min(totalSupplierPages - 1, p + 1))}
                                    className="btn btn-ghost"
                                    style={{ padding: '4px 10px', fontSize: '12px' }}
                                >
                                    Weiter →
                                </button>
                            </div>
                        )}
                    </div>

                    <button
                        type="button"
                        onClick={handleBulkSave}
                        disabled={savingBulk || (activeTab === 'products' ? selectedProductIds.size === 0 : selectedSupplierIds.size === 0)}
                        className="btn btn-primary"
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                            padding: '10px 18px',
                            fontWeight: 700,
                            opacity: savingBulk ? 0.7 : 1
                        }}
                    >
                        {savingBulk ? (
                            <>
                                <Loader2 size={16} className="spin" />
                                Speichert...
                            </>
                        ) : (
                            <>
                                <CheckCircle2 size={16} />
                                Ausgewählte speichern & als vollständig abhaken ({activeTab === 'products' ? selectedProductIds.size : selectedSupplierIds.size})
                            </>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
