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
    ArrowLeft,
    Edit2
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
    isEditing?: boolean;
    aiFields?: {
        image?: boolean;
        orderUrl?: boolean;
        productNumber?: boolean;
        category?: boolean;
        unit?: boolean;
        price?: boolean;
    };
    priceCheck?: {
        status: 'ok' | 'warning' | 'new_price' | 'none';
        shopPrice: number | null;
        knownPrice: number | null;
        message: string;
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
    isEditing?: boolean;
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

const BATCH_SIZE = 8;

export const DataCompletionModal: React.FC<DataCompletionModalProps> = ({
    isOpen,
    onClose,
    products,
    suppliers,
    initialTab = 'products',
    onSaved
}) => {
    const [activeTab, setActiveTab] = useState<'products' | 'suppliers'>(initialTab);
    // Zwei getrennte Fenster-Zustände:
    // 1. 'overview': Übersicht mit dem riesigen Button "KI Daten ergänzen lassen"
    // 2. 'review': Separates Prüffenster, das sich nach dem KI-Durchlauf öffnet, um die Ergebnisse einfach abzuhaken
    const [viewMode, setViewMode] = useState<'overview' | 'review'>('overview');
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

    // Welche Einträge wurden gerade von der KI geprüft und liegen im Prüffenster?
    const [reviewedIds, setReviewedIds] = useState<string[]>([]);
    const [selectedReviewIds, setSelectedReviewIds] = useState<Set<string>>(new Set());

    const [overviewPage, setOverviewPage] = useState(0);

    useEffect(() => {
        if (!isOpen) return;
        setActiveTab(initialTab);
        setViewMode('overview');
        setOverviewPage(0);
        setReviewedIds([]);
        initDraftsAndState();
    }, [isOpen, initialTab]);

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

    const pagedOverviewProducts = useMemo(() => {
        const start = overviewPage * BATCH_SIZE;
        return filteredProducts.slice(start, start + BATCH_SIZE);
    }, [filteredProducts, overviewPage]);

    const pagedOverviewSuppliers = useMemo(() => {
        const start = overviewPage * BATCH_SIZE;
        return filteredSuppliers.slice(start, start + BATCH_SIZE);
    }, [filteredSuppliers, overviewPage]);

    const revertProductDraft = (productId: string) => {
        const orig = products.find(p => p.id === productId);
        if (!orig) return;
        setProductDrafts(prev => ({
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
                isEditing: false,
                aiFields: {},
                priceCheck: undefined
            }
        }));
        setSelectedReviewIds(prev => {
            const next = new Set(prev);
            next.delete(productId);
            return next;
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
                isEditing: false,
                aiFields: {}
            }
        }));
        setSelectedReviewIds(prev => {
            const next = new Set(prev);
            next.delete(supplierId);
            return next;
        });
    };

    // Hauptaktion: Klick auf den riesigen Button "KI Daten ergänzen lassen"
    // Lädt die KI-Vorschläge und öffnet automatisch das Prüffenster ('review')!
    const startAiCompletionAndOpenReview = async () => {
        if (!supabase || aiLoading) return;
        setAiLoading(true);
        setError(null);
        try {
            if (activeTab === 'products') {
                const targetBatch = pagedOverviewProducts.length > 0
                    ? pagedOverviewProducts
                    : filteredProducts.slice(0, BATCH_SIZE);
                if (targetBatch.length === 0) return;

                const itemsPayload = targetBatch.map(p => {
                    const d = productDrafts[p.id];
                    const sup = suppliers.find(s => s.id === (d?.supplierId || p.supplierId));
                    const webshop = isSupplierWebshop(sup, d || p);
                    return {
                        id: p.id,
                        type: 'product',
                        name: d?.name || p.name,
                        productNumber: d?.productNumber || p.productNumber || '',
                        price: d?.price ?? p.price ?? 0,
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
                const batchIds = targetBatch.map(p => p.id);

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
                        const newPrice = (!cur.price || Number(cur.price) === 0) && s.price && Number(s.price) > 0 ? Number(s.price) : cur.price;
                        const newCat = (!cur.category || cur.category === 'Sonstiges' || cur.category === 'Ohne Kategorie') && s.category && s.category !== 'Sonstiges'
                            ? s.category
                            : cur.category;

                        const aiFields = {
                            ...(cur.aiFields || {}),
                            image: !cur.image && !!s.image ? true : cur.aiFields?.image,
                            orderUrl: allowShopLink && !cur.orderUrl && !!s.orderUrl ? true : cur.aiFields?.orderUrl,
                            productNumber: !cur.productNumber && !!s.productNumber ? true : cur.aiFields?.productNumber,
                            price: (!cur.price || Number(cur.price) === 0) && !!s.price && Number(s.price) > 0 ? true : cur.aiFields?.price,
                            category: (!cur.category || cur.category === 'Sonstiges' || cur.category === 'Ohne Kategorie') && !!s.category && s.category !== 'Sonstiges' ? true : cur.aiFields?.category,
                        };

                        next[s.id] = {
                            ...cur,
                            image: newImage,
                            orderUrl: newOrderUrl,
                            productNumber: newProdNum,
                            price: newPrice,
                            priceCheck: s.priceCheck || cur.priceCheck,
                            category: newCat,
                            alternatives: Array.isArray(s.alternatives) && s.alternatives.length > 0 ? s.alternatives : cur.alternatives,
                            aiFields,
                            aiSuggested: Object.values(aiFields).some(Boolean)
                        };
                    }
                    return next;
                });

                setReviewedIds(batchIds);
                setSelectedReviewIds(new Set(batchIds));
                setViewMode('review');
            } else {
                const targetBatch = pagedOverviewSuppliers.length > 0
                    ? pagedOverviewSuppliers
                    : filteredSuppliers.slice(0, BATCH_SIZE);
                if (targetBatch.length === 0) return;

                const itemsPayload = targetBatch.map(s => {
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
                const batchIds = targetBatch.map(s => s.id);

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

                setReviewedIds(batchIds);
                setSelectedReviewIds(new Set(batchIds));
                setViewMode('review');
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
                    supplierName: sup?.name || '',
                    knownPrice: d.price || 0
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
                        price: (!cur.price || cur.price === 0) && !!data.price ? true : cur.aiFields?.price,
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
                            priceCheck: data.priceCheck || cur.priceCheck,
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
            setReviewedIds(prev => prev.filter(id => !idsToSave.includes(id)));
            setSelectedReviewIds(prev => {
                const next = new Set(prev);
                idsToSave.forEach(id => next.delete(id));
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
            setReviewedIds(prev => prev.filter(id => !idsToSave.includes(id)));
            setSelectedReviewIds(prev => {
                const next = new Set(prev);
                idsToSave.forEach(id => next.delete(id));
                return next;
            });
        }
    };

    const handleDeleteProductImage = async (productId: string) => {
        setProductDrafts(prev => {
            const cur = prev[productId];
            if (!cur) return prev;
            return {
                ...prev,
                [productId]: {
                    ...cur,
                    image: '',
                    aiFields: { ...(cur.aiFields || {}), image: false }
                }
            };
        });
        if (!supabase) return;
        try {
            const d = productDrafts[productId];
            await supabase.functions.invoke('process-inbound-mail', {
                body: {
                    action: 'save_completion',
                    products: [{
                        id: productId,
                        name: d?.name,
                        image: null,
                        markComplete: false
                    }]
                }
            });
            onSaved('Produktbild wurde gelöscht.');
        } catch (err) {
            console.warn('Could not delete product image:', err);
        }
    };

    const handleSaveSingleRow = async (id: string, type: 'product' | 'supplier') => {
        setSavingRowId(id);
        setError(null);
        try {
            if (type === 'product') {
                await saveProductRows([id], true);
                onSaved('Produkt gespeichert & abgehakt.');
            } else {
                await saveSupplierRows([id], true);
                onSaved('Lieferant gespeichert & abgehakt.');
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

    const handleBulkAcceptReview = async () => {
        setSavingBulk(true);
        setError(null);
        try {
            const ids = Array.from(selectedReviewIds);
            if (ids.length === 0) return;
            if (activeTab === 'products') {
                await saveProductRows(ids, true);
                onSaved(`${ids.length} ${ids.length === 1 ? 'Produkt' : 'Produkte'} übernommen & als erledigt abgehakt!`);
            } else {
                await saveSupplierRows(ids, true);
                onSaved(`${ids.length} ${ids.length === 1 ? 'Lieferant' : 'Lieferanten'} übernommen & als erledigt abgehakt!`);
            }
            setViewMode('overview');
        } catch (err: any) {
            setError(err?.message || 'Fehler beim Speichern.');
        } finally {
            setSavingBulk(false);
        }
    };

    if (!isOpen) return null;

    const totalOverviewPages = Math.max(
        1,
        Math.ceil((activeTab === 'products' ? filteredProducts.length : filteredSuppliers.length) / BATCH_SIZE)
    );

    // ============================================================================
    // FENSTER 2: PRÜFFENSTER ("KI-Ergebnisse prüfen & abhaken")
    // Öffnet sich automatisch, nachdem man auf "KI Daten ergänzen lassen" geklickt hat
    // ============================================================================
    if (viewMode === 'review') {
        const visibleReviewProducts = reviewedIds
            .map(id => products.find(p => p.id === id))
            .filter((p): p is Product => !!p);
        const visibleReviewSuppliers = reviewedIds
            .map(id => suppliers.find(s => s.id === id))
            .filter((s): s is Supplier => !!s);

        return (
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    backgroundColor: 'rgba(15, 23, 42, 0.72)',
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
                        borderRadius: '18px',
                        width: '100%',
                        maxWidth: '940px',
                        maxHeight: '90vh',
                        display: 'flex',
                        flexDirection: 'column',
                        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
                        border: '2px solid #8b5cf6',
                        overflow: 'hidden'
                    }}
                    onClick={e => e.stopPropagation()}
                >
                    {/* Header des Prüffensters */}
                    <div style={{
                        padding: '18px 24px',
                        borderBottom: '1px solid #ddd6fe',
                        background: 'linear-gradient(135deg, #f5f3ff 0%, #eef2ff 100%)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                        flexWrap: 'wrap'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                            <button
                                type="button"
                                onClick={() => setViewMode('overview')}
                                style={{
                                    padding: '8px 12px',
                                    borderRadius: '8px',
                                    border: '1px solid #c4b5fd',
                                    backgroundColor: '#fff',
                                    color: '#5b21b6',
                                    fontWeight: 600,
                                    fontSize: '13px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px'
                                }}
                            >
                                <ArrowLeft size={15} /> Zurück
                            </button>
                            <div>
                                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#1e1b4b' }}>
                                    ✨ KI-Vorschläge prüfen & abhaken ({reviewedIds.length})
                                </h3>
                                <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: '#4c1d95' }}>
                                    Schau kurz über die gefundenen Bilder & Daten – was passt, kannst du direkt rechts (oder unten gesammelt) abhaken.
                                </p>
                            </div>
                        </div>

                        <button
                            onClick={onClose}
                            style={{
                                background: '#fff',
                                border: '1px solid #c4b5fd',
                                borderRadius: '8px',
                                padding: '6px',
                                cursor: 'pointer',
                                color: '#5b21b6',
                                display: 'flex'
                            }}
                        >
                            <X size={18} />
                        </button>
                    </div>

                    {error && (
                        <div style={{ margin: '12px 24px 0 24px', padding: '10px 14px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '13px' }}>
                            {error}
                        </div>
                    )}

                    {/* Liste der geprüften Karten */}
                    <div style={{
                        padding: '18px 24px',
                        overflowY: 'auto',
                        flex: 1,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '12px',
                        backgroundColor: '#f8fafc'
                    }}>
                        {reviewedIds.length === 0 ? (
                            <div style={{ padding: '48px', textAlign: 'center' }}>
                                <CheckCircle2 size={44} color="#16a34a" style={{ margin: '0 auto 12px auto' }} />
                                <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                    Alle Vorschläge aus diesem Durchgang sind erledigt!
                                </div>
                                <button
                                    type="button"
                                    onClick={() => setViewMode('overview')}
                                    className="btn btn-primary"
                                    style={{ marginTop: '16px' }}
                                >
                                    Zurück zur Übersicht
                                </button>
                            </div>
                        ) : activeTab === 'products' ? (
                            visibleReviewProducts.map(p => {
                                const d = productDrafts[p.id];
                                if (!d) return null;
                                const isChecked = selectedReviewIds.has(p.id);
                                const sup = suppliers.find(s => s.id === d.supplierId);
                                const isWebshop = isSupplierWebshop(sup, d);

                                return (
                                    <div
                                        key={p.id}
                                        style={{
                                            backgroundColor: '#ffffff',
                                            borderRadius: '14px',
                                            padding: '14px 18px',
                                            border: isChecked ? '2px solid #7c3aed' : '1px solid var(--color-border)',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '12px',
                                            boxShadow: '0 2px 6px rgba(0,0,0,0.04)'
                                        }}
                                    >
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: '28px 92px 1fr auto',
                                            gap: '16px',
                                            alignItems: 'center'
                                        }}>
                                            {/* Auswahl-Häkchen */}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    setSelectedReviewIds(prev => {
                                                        const next = new Set(prev);
                                                        if (next.has(p.id)) next.delete(p.id);
                                                        else next.add(p.id);
                                                        return next;
                                                    });
                                                }}
                                                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: isChecked ? '#7c3aed' : '#94a3b8' }}
                                            >
                                                {isChecked ? <CheckSquare size={22} /> : <Square size={22} />}
                                            </button>

                                            {/* Gefundenes Produktbild + Alternativen + Löschen */}
                                            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}>
                                                <div style={{
                                                    width: '76px',
                                                    height: '76px',
                                                    borderRadius: '10px',
                                                    border: '1px solid var(--color-border)',
                                                    backgroundColor: '#f8fafc',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    overflow: 'hidden',
                                                    position: 'relative'
                                                }}>
                                                    {d.image ? (
                                                        <img src={d.image} alt={d.name} style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#fff' }} />
                                                    ) : (
                                                        <span style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'center' }}>Kein Bild</span>
                                                    )}
                                                </div>

                                                {d.image && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteProductImage(p.id)}
                                                        style={{
                                                            padding: '2px 8px',
                                                            borderRadius: '6px',
                                                            border: '1px solid #fecaca',
                                                            backgroundColor: '#fef2f2',
                                                            color: '#dc2626',
                                                            fontSize: '11px',
                                                            fontWeight: 600,
                                                            cursor: 'pointer',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            gap: '3px'
                                                        }}
                                                    >
                                                        <X size={11} /> Bild löschen
                                                    </button>
                                                )}

                                                {d.alternatives && d.alternatives.length > 1 && (
                                                    <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                                                        {d.alternatives.slice(0, 4).map((altUrl, idx) => (
                                                            <img
                                                                key={idx}
                                                                src={altUrl}
                                                                alt=""
                                                                onClick={() => setProductDrafts(prev => ({
                                                                    ...prev,
                                                                    [p.id]: { ...prev[p.id], image: altUrl }
                                                                }))}
                                                                style={{
                                                                    width: '20px',
                                                                    height: '20px',
                                                                    borderRadius: '4px',
                                                                    objectFit: 'cover',
                                                                    cursor: 'pointer',
                                                                    border: d.image === altUrl ? '2px solid #7c3aed' : '1px solid #cbd5e1'
                                                                }}
                                                                title="Anderes Bild wählen"
                                                            />
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* Mitte: Übersichtliche Zusammenfassung ohne Formular-Chaos */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                                                    {d.name}
                                                </div>
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px', color: '#475569' }}>
                                                    <span style={{ backgroundColor: '#f1f5f9', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                        Lieferant: {sup?.name || 'Nicht zugeordnet'}
                                                    </span>
                                                    <span style={{ backgroundColor: d.aiFields?.category ? '#f5f3ff' : '#f1f5f9', color: d.aiFields?.category ? '#6d28d9' : '#475569', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                        Kategorie: {d.category} {d.aiFields?.category && '✨'}
                                                    </span>
                                                    {d.productNumber && (
                                                        <span style={{ backgroundColor: d.aiFields?.productNumber ? '#f5f3ff' : '#f1f5f9', color: d.aiFields?.productNumber ? '#6d28d9' : '#475569', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                            Art.-Nr.: {d.productNumber} {d.aiFields?.productNumber && '✨'}
                                                        </span>
                                                    )}
                                                    {d.price > 0 && (
                                                        <span style={{ backgroundColor: d.aiFields?.price ? '#f5f3ff' : '#f1f5f9', color: d.aiFields?.price ? '#6d28d9' : '#475569', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                            Preis: {Number(d.price).toFixed(2).replace('.', ',')} € {d.aiFields?.price && '✨'}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* Shop-Link / Bestellweg Info */}
                                                {d.orderUrl ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '12px' }}>
                                                        <a
                                                            href={/^https?:\/\//i.test(d.orderUrl) ? d.orderUrl : `https://${d.orderUrl}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            style={{ color: '#2563eb', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                                                        >
                                                            <ExternalLink size={13} />
                                                            Gefundener Shop-Link prüfen
                                                        </a>
                                                        <button
                                                            type="button"
                                                            onClick={() => setProductDrafts(prev => ({
                                                                ...prev,
                                                                [p.id]: { ...prev[p.id], orderUrl: '', priceCheck: undefined }
                                                            }))}
                                                            style={{ background: 'none', border: 'none', color: '#dc2626', fontSize: '11px', cursor: 'pointer', padding: 0, fontWeight: 600 }}
                                                        >
                                                            ✕ Link löschen
                                                        </button>
                                                        {d.priceCheck?.message && (
                                                            <span style={{
                                                                padding: '2px 8px',
                                                                borderRadius: '6px',
                                                                fontSize: '11px',
                                                                fontWeight: 600,
                                                                backgroundColor: d.priceCheck.status === 'warning' ? '#fffbeb' : '#f0fdf4',
                                                                color: d.priceCheck.status === 'warning' ? '#b45309' : '#15803d',
                                                                border: d.priceCheck.status === 'warning' ? '1px solid #fcd34d' : '1px solid #bbf7d0'
                                                            }}>
                                                                {d.priceCheck.message}
                                                            </span>
                                                        )}
                                                    </div>
                                                ) : !isWebshop ? (
                                                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                                                        📧 Bestellung per {sup?.preferredOrderMethod === 'phone' ? 'Telefon' : 'E-Mail'} (kein Shop-Link nötig)
                                                    </div>
                                                ) : (
                                                    <div style={{ fontSize: '12px', color: '#b45309' }}>
                                                        Kein eindeutiger Shop-Link gefunden – klicke auf „Ändern“, falls du einen Link einfügen möchtest.
                                                    </div>
                                                )}
                                            </div>

                                            {/* Rechts: Klare Buttons (Abhaken / Ändern / Verwerfen) */}
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setProductDrafts(prev => ({
                                                        ...prev,
                                                        [p.id]: { ...prev[p.id], isEditing: !prev[p.id].isEditing }
                                                    }))}
                                                    style={{
                                                        padding: '8px 12px',
                                                        borderRadius: '8px',
                                                        border: '1px solid var(--color-border)',
                                                        backgroundColor: '#fff',
                                                        color: '#334155',
                                                        fontSize: '12px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '5px'
                                                    }}
                                                    title="Manuell korrigieren"
                                                >
                                                    <Edit2 size={13} /> Ändern
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => revertProductDraft(p.id)}
                                                    style={{
                                                        padding: '8px 10px',
                                                        borderRadius: '8px',
                                                        border: '1px solid #fecaca',
                                                        backgroundColor: '#fef2f2',
                                                        color: '#dc2626',
                                                        fontSize: '12px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer'
                                                    }}
                                                    title="KI-Vorschlag ablehnen & zurücksetzen"
                                                >
                                                    <RotateCcw size={14} />
                                                </button>

                                                <button
                                                    type="button"
                                                    onClick={() => handleSaveSingleRow(p.id, 'product')}
                                                    disabled={savingRowId === p.id}
                                                    style={{
                                                        padding: '9px 16px',
                                                        borderRadius: '8px',
                                                        border: 'none',
                                                        backgroundColor: '#16a34a',
                                                        color: '#fff',
                                                        fontWeight: 700,
                                                        fontSize: '13px',
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '6px',
                                                        whiteSpace: 'nowrap'
                                                    }}
                                                >
                                                    {savingRowId === p.id ? <Loader2 size={15} className="spin" /> : <CheckCircle2 size={15} />}
                                                    ✓ Abhaken
                                                </button>
                                            </div>
                                        </div>

                                        {/* Aufklappbarer Korrektur-Bereich (nur sichtbar, wenn man auf "Ändern" klickt!) */}
                                        {d.isEditing && (
                                            <div style={{
                                                marginTop: '4px',
                                                paddingTop: '12px',
                                                borderTop: '1px dashed var(--color-border)',
                                                display: 'grid',
                                                gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                                                gap: '10px'
                                            }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '3px' }}>Lieferant</label>
                                                    <select
                                                        value={d.supplierId}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], supplierId: e.target.value } }))}
                                                        className="input-field"
                                                        style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                                                    >
                                                        <option value="">-- Lieferant --</option>
                                                        {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '3px' }}>Kategorie</label>
                                                    <select
                                                        value={d.category}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], category: e.target.value } }))}
                                                        className="input-field"
                                                        style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                                                    >
                                                        {STANDARD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '3px' }}>Shop-Link (lädt automatisch Bild)</label>
                                                    <input
                                                        type="url"
                                                        placeholder="https://..."
                                                        value={d.orderUrl}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], orderUrl: e.target.value } }))}
                                                        onPaste={e => {
                                                            const pasted = e.clipboardData?.getData('text') || '';
                                                            if (pasted && /^https?:\/\//i.test(pasted.trim())) {
                                                                setTimeout(() => handleExtractFromOrderUrl(p.id, pasted.trim()), 50);
                                                            }
                                                        }}
                                                        className="input-field"
                                                        style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                                                    />
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        ) : (
                            visibleReviewSuppliers.map(s => {
                                const d = supplierDrafts[s.id];
                                if (!d) return null;
                                const isChecked = selectedReviewIds.has(s.id);

                                return (
                                    <div
                                        key={s.id}
                                        style={{
                                            backgroundColor: '#ffffff',
                                            borderRadius: '14px',
                                            padding: '14px 18px',
                                            border: isChecked ? '2px solid #7c3aed' : '1px solid var(--color-border)',
                                            display: 'grid',
                                            gridTemplateColumns: '28px 1fr auto',
                                            gap: '16px',
                                            alignItems: 'center'
                                        }}
                                    >
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedReviewIds(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(s.id)) next.delete(s.id);
                                                    else next.add(s.id);
                                                    return next;
                                                });
                                            }}
                                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: isChecked ? '#7c3aed' : '#94a3b8' }}
                                        >
                                            {isChecked ? <CheckSquare size={22} /> : <Square size={22} />}
                                        </button>

                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                            <div style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{d.name}</div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '8px' }}>
                                                <input
                                                    type="url"
                                                    placeholder="Webseite (https://...)"
                                                    value={d.url}
                                                    onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], url: e.target.value } }))}
                                                    className="input-field"
                                                    style={{ padding: '6px 10px', fontSize: '12px' }}
                                                />
                                                <input
                                                    type="email"
                                                    placeholder="E-Mail"
                                                    value={d.email}
                                                    onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], email: e.target.value } }))}
                                                    className="input-field"
                                                    style={{ padding: '6px 10px', fontSize: '12px' }}
                                                />
                                                <input
                                                    type="tel"
                                                    placeholder="Telefon"
                                                    value={d.phone}
                                                    onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], phone: e.target.value } }))}
                                                    className="input-field"
                                                    style={{ padding: '6px 10px', fontSize: '12px' }}
                                                />
                                            </div>
                                        </div>

                                        <div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                type="button"
                                                onClick={() => revertSupplierDraft(s.id)}
                                                style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                                            >
                                                <RotateCcw size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => handleSaveSingleRow(s.id, 'supplier')}
                                                disabled={savingRowId === s.id}
                                                style={{
                                                    padding: '9px 16px',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    backgroundColor: '#16a34a',
                                                    color: '#fff',
                                                    fontWeight: 700,
                                                    fontSize: '13px',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px'
                                                }}
                                            >
                                                <CheckCircle2 size={15} /> ✓ Abhaken
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>

                    {/* Footer des Prüffensters */}
                    <div style={{
                        padding: '16px 24px',
                        borderTop: '1px solid var(--color-border)',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: '12px',
                        backgroundColor: '#fff'
                    }}>
                        <button
                            type="button"
                            onClick={() => setViewMode('overview')}
                            className="btn btn-ghost"
                        >
                            ← Zurück zur Übersicht
                        </button>

                        <button
                            type="button"
                            onClick={handleBulkAcceptReview}
                            disabled={savingBulk || selectedReviewIds.size === 0}
                            style={{
                                padding: '12px 24px',
                                borderRadius: '10px',
                                border: 'none',
                                backgroundColor: '#16a34a',
                                color: '#fff',
                                fontWeight: 800,
                                fontSize: '14px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                boxShadow: '0 4px 14px rgba(22, 163, 74, 0.3)'
                            }}
                        >
                            {savingBulk ? (
                                <>
                                    <Loader2 size={18} className="spin" /> Speichert...
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 size={18} />
                                    ✓ Alle ausgewählten übernehmen & abhaken ({selectedReviewIds.size})
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // ============================================================================
    // FENSTER 1: START-ÜBERSICHT MIT RIESIGEM BUTTON "KI Daten ergänzen lassen"
    // ============================================================================
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
                    borderRadius: '18px',
                    width: '100%',
                    maxWidth: '900px',
                    maxHeight: '90vh',
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
                    alignItems: 'center'
                }}>
                    <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                        Daten vervollständigen
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: 'var(--color-text-muted)', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={showCompleted}
                                onChange={e => {
                                    setShowCompleted(e.target.checked);
                                    setOverviewPage(0);
                                }}
                            />
                            Bereits erledigte anzeigen
                        </label>
                        <button
                            onClick={onClose}
                            style={{ background: 'none', border: '1px solid var(--color-border)', borderRadius: '8px', padding: '6px', cursor: 'pointer', display: 'flex' }}
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* RIESIGER HAUPT-BUTTON OBEN: "KI Daten ergänzen lassen" */}
                <div style={{
                    padding: '20px 24px',
                    background: 'linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%)',
                    borderBottom: '1px solid #ddd6fe',
                    textAlign: 'center'
                }}>
                    <button
                        type="button"
                        onClick={startAiCompletionAndOpenReview}
                        disabled={aiLoading || (activeTab === 'products' ? filteredProducts.length === 0 : filteredSuppliers.length === 0)}
                        style={{
                            width: '100%',
                            padding: '18px 24px',
                            borderRadius: '14px',
                            border: 'none',
                            background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
                            color: '#ffffff',
                            fontSize: '18px',
                            fontWeight: 800,
                            cursor: aiLoading ? 'wait' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '12px',
                            boxShadow: '0 10px 25px -5px rgba(124, 58, 237, 0.45)',
                            transition: 'transform 0.15s ease'
                        }}
                    >
                        {aiLoading ? (
                            <>
                                <Loader2 size={24} className="spin" />
                                KI sucht passende Bilder, Links & Daten – Prüffenster öffnet gleich...
                            </>
                        ) : (
                            <>
                                <Sparkles size={24} />
                                ✨ KI Daten ergänzen lassen
                            </>
                        )}
                    </button>
                    <div style={{ marginTop: '8px', fontSize: '13px', color: '#4c1d95', fontWeight: 500 }}>
                        Sucht automatisch Produktbilder, Kategorien & Webshop-Links heraus und öffnet danach das Prüffenster zum einfachen Abhaken.
                    </div>
                </div>

                {/* Tabs: Produkte / Lieferanten */}
                <div style={{
                    padding: '12px 24px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex',
                    gap: '8px',
                    backgroundColor: 'var(--color-surface)'
                }}>
                    <button
                        type="button"
                        onClick={() => { setActiveTab('products'); setOverviewPage(0); }}
                        style={{
                            padding: '8px 16px',
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
                        <Package size={15} /> Offene Produkte ({filteredProducts.length})
                    </button>
                    <button
                        type="button"
                        onClick={() => { setActiveTab('suppliers'); setOverviewPage(0); }}
                        style={{
                            padding: '8px 16px',
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
                        <Building2 size={15} /> Offene Lieferanten ({filteredSuppliers.length})
                    </button>
                </div>

                {error && (
                    <div style={{ margin: '12px 24px 0 24px', padding: '10px 14px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                {/* Kompakte, ruhige Übersichts-Liste */}
                <div style={{
                    padding: '14px 24px',
                    overflowY: 'auto',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    backgroundColor: '#f8fafc'
                }}>
                    {loadingState ? (
                        <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                            <Loader2 size={28} className="spin" style={{ margin: '0 auto 12px auto' }} />
                            Lade offene Einträge...
                        </div>
                    ) : activeTab === 'products' ? (
                        pagedOverviewProducts.length === 0 ? (
                            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                <CheckCircle2 size={42} color="#16a34a" style={{ margin: '0 auto 12px auto' }} />
                                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                    Alle Produkte sind vollständig!
                                </div>
                            </div>
                        ) : (
                            pagedOverviewProducts.map(p => {
                                const d = productDrafts[p.id];
                                if (!d) return null;
                                const sup = suppliers.find(s => s.id === d.supplierId);
                                const isWebshop = isSupplierWebshop(sup, d);
                                const isCompleted = completedProductIds.has(p.id) || isProductNaturallyComplete(p);

                                return (
                                    <div
                                        key={p.id}
                                        style={{
                                            backgroundColor: '#fff',
                                            border: '1px solid var(--color-border)',
                                            borderRadius: '10px',
                                            padding: '10px 14px',
                                            display: 'flex',
                                            flexDirection: 'column',
                                            gap: '10px'
                                        }}
                                    >
                                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0, flex: 1 }}>
                                                <div style={{
                                                    width: '44px',
                                                    height: '44px',
                                                    borderRadius: '8px',
                                                    border: '1px solid var(--color-border)',
                                                    backgroundColor: '#f8fafc',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    overflow: 'hidden',
                                                    flexShrink: 0
                                                }}>
                                                    {d.image ? (
                                                        <img src={d.image} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#fff' }} />
                                                    ) : (
                                                        <ImageIcon size={18} color="#94a3b8" />
                                                    )}
                                                </div>
                                                <div style={{ minWidth: 0, flex: 1 }}>
                                                    <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {d.name}
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '3px', fontSize: '11px', color: '#64748b' }}>
                                                        <span>{sup?.name || 'Kein Lieferant'}</span>
                                                        {!d.image && <span style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '999px', fontWeight: 600 }}>Kein Bild</span>}
                                                        {isWebshop && !d.orderUrl && <span style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '999px', fontWeight: 600 }}>Kein Shop-Link</span>}
                                                    </div>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                                {d.image && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteProductImage(p.id)}
                                                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', fontSize: '12px', cursor: 'pointer', color: '#dc2626', fontWeight: 600 }}
                                                    >
                                                        ✕ Bild löschen
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], isEditing: !prev[p.id].isEditing } }))}
                                                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: '#fff', fontSize: '12px', cursor: 'pointer', color: '#475569' }}
                                                >
                                                    ✏️ Manuell
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => handleSaveSingleRow(p.id, 'product')}
                                                    disabled={savingRowId === p.id}
                                                    style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', backgroundColor: '#16a34a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                                >
                                                    {savingRowId === p.id ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}
                                                    Erledigt
                                                </button>
                                                {isCompleted && showCompleted && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUnmarkComplete(p.id, 'product')}
                                                        style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: '#fff', fontSize: '11px', cursor: 'pointer' }}
                                                    >
                                                        Wieder offen
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {d.isEditing && (
                                            <div style={{ paddingTop: '10px', borderTop: '1px dashed var(--color-border)', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '8px' }}>
                                                <select
                                                    value={d.supplierId}
                                                    onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], supplierId: e.target.value } }))}
                                                    className="input-field"
                                                    style={{ padding: '6px 8px', fontSize: '12px' }}
                                                >
                                                    <option value="">-- Lieferant --</option>
                                                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                </select>
                                                <select
                                                    value={d.category}
                                                    onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], category: e.target.value } }))}
                                                    className="input-field"
                                                    style={{ padding: '6px 8px', fontSize: '12px' }}
                                                >
                                                    {STANDARD_CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                                <input
                                                    type="url"
                                                    placeholder="Shop-Link (lädt automatisch Bild)"
                                                    value={d.orderUrl}
                                                    onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], orderUrl: e.target.value } }))}
                                                    onPaste={e => {
                                                        const pasted = e.clipboardData?.getData('text') || '';
                                                        if (pasted && /^https?:\/\//i.test(pasted.trim())) {
                                                            setTimeout(() => handleExtractFromOrderUrl(p.id, pasted.trim()), 50);
                                                        }
                                                    }}
                                                    className="input-field"
                                                    style={{ padding: '6px 8px', fontSize: '12px' }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )
                    ) : (
                        pagedOverviewSuppliers.map(s => {
                            const d = supplierDrafts[s.id];
                            if (!d) return null;
                            return (
                                <div
                                    key={s.id}
                                    style={{
                                        backgroundColor: '#fff',
                                        border: '1px solid var(--color-border)',
                                        borderRadius: '10px',
                                        padding: '10px 14px',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: '12px'
                                    }}
                                >
                                    <div>
                                        <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{d.name}</div>
                                        <div style={{ fontSize: '12px', color: '#64748b' }}>
                                            {d.email || 'Keine E-Mail'} · {d.url || 'Keine Webseite'}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => handleSaveSingleRow(s.id, 'supplier')}
                                        disabled={savingRowId === s.id}
                                        style={{ padding: '6px 12px', borderRadius: '6px', border: 'none', backgroundColor: '#16a34a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                                    >
                                        <CheckCircle2 size={13} /> Erledigt
                                    </button>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '12px 24px',
                    borderTop: '1px solid var(--color-border)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    backgroundColor: 'var(--color-surface)'
                }}>
                    <button type="button" onClick={onClose} className="btn btn-ghost">
                        Schließen
                    </button>

                    {totalOverviewPages > 1 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', color: 'var(--color-text-muted)' }}>
                            <button
                                type="button"
                                disabled={overviewPage === 0}
                                onClick={() => setOverviewPage(p => Math.max(0, p - 1))}
                                className="btn btn-ghost"
                                style={{ padding: '4px 10px', fontSize: '12px' }}
                            >
                                ← Zurück
                            </button>
                            <span>Seite {overviewPage + 1} von {totalOverviewPages}</span>
                            <button
                                type="button"
                                disabled={overviewPage + 1 >= totalOverviewPages}
                                onClick={() => setOverviewPage(p => Math.min(totalOverviewPages - 1, p + 1))}
                                className="btn btn-ghost"
                                style={{ padding: '4px 10px', fontSize: '12px' }}
                            >
                                Weiter →
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};
