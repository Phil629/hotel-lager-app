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
    onCountsChange?: (counts: { openProducts: number; openSuppliers: number }) => void;
}

interface ProductDraft {
    id: string;
    name: string;
    originalName: string;
    category: string;
    unit: string;
    price: number;
    minStock: number;
    standardOrderQuantity: number;
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
        name?: boolean;
        image?: boolean;
        orderUrl?: boolean;
        productNumber?: boolean;
        supplierId?: boolean;
        category?: boolean;
        unit?: boolean;
        price?: boolean;
        minStock?: boolean;
        standardOrderQuantity?: boolean;
        preferredOrderMethod?: boolean;
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
        preferredOrderMethod?: boolean;
    };
}

const STANDARD_CATEGORIES = [
    'Lebensmittel',
    'Getränke',
    'Reinigung',
    'Hygiene',
    'Bürobedarf',
    'Instandhaltung',
    'Hotel & Gastro',
    'Hotelbedarf',
    'Gastronomiebedarf',
    'Technik',
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
    'intergastro',
    'fixpart',
    'faironto'
];

const EMAIL_ONLY_SUPPLIER_KEYWORDS = [
    'hewo',
    'schwälbchen',
    'schwaelbchen',
    'frischdienst',
    'getränke-vertrieb',
    'getraenke-vertrieb',
    'wäscherei',
    'waescherei',
    'bäckerei',
    'baeckerei',
    'metzgerei'
];

const BATCH_SIZE = 8;

export const DataCompletionModal: React.FC<DataCompletionModalProps> = ({
    isOpen,
    onClose,
    products,
    suppliers,
    initialTab = 'products',
    onSaved,
    onCountsChange
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
    const [aiLoadingSeconds, setAiLoadingSeconds] = useState(0);

    useEffect(() => {
        if (!aiLoading) {
            setAiLoadingSeconds(0);
            return;
        }
        const interval = setInterval(() => {
            setAiLoadingSeconds(s => s + 1);
        }, 1000);
        return () => clearInterval(interval);
    }, [aiLoading]);

    const getAiLoadingStatus = (sec: number) => {
        if (sec < 4) {
            return {
                step: 'Schritt 1 von 3',
                title: 'Analysiere Artikeldaten & bereinige Produktnamen...',
                detail: 'Kategorien und Schreibweisen werden standardisiert'
            };
        }
        if (sec < 9) {
            return {
                step: 'Schritt 2 von 3',
                title: 'Durchsuche Lieferanten-Kataloge nach Bildern & Shop-Links...',
                detail: 'Webshops und Großhändler werden nach passenden Artikeln gescannt'
            };
        }
        return {
            step: 'Schritt 3 von 3',
            title: 'Prüfe Einkaufspreise & bereite Prüffenster vor...',
            detail: 'Gefundene Shop-Preise werden geprüft – Prüffenster öffnet gleich'
        };
    };

    const loadCompletionIdsOnly = async () => {
        if (!supabase) return;
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
        }
    };

    useEffect(() => {
        loadCompletionIdsOnly();
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        setActiveTab(initialTab);
        setViewMode('overview');
        setOverviewPage(0);
        setReviewedIds([]);
        initDraftsAndState();
    }, [isOpen, initialTab]);

    const isEmailOnlySupplier = (sup?: Supplier | null): boolean => {
        if (!sup) return false;
        const lower = `${sup.name || ''} ${sup.email || ''}`.toLowerCase();
        return EMAIL_ONLY_SUPPLIER_KEYWORDS.some(k => lower.includes(k));
    };

    const isSupplierWebshop = (sup?: Supplier | null, prod?: Product | ProductDraft | null): boolean => {
        if (isEmailOnlySupplier(sup)) return false;
        if (prod?.preferredOrderMethod === 'webshop' || prod?.preferredOrderMethod === 'link') return true;
        if (isDeepProductUrl(prod?.orderUrl)) return true;
        if (!sup) return false;
        if (sup.preferredOrderMethod === 'webshop' || sup.preferredOrderMethod === 'link') return true;
        if (isDeepProductUrl(sup.orderUrl)) return true;
        const lowerName = (sup.name || '').toLowerCase();
        if (KNOWN_WEBSHOP_KEYWORDS.some(k => lowerName.includes(k))) return true;
        const lowerUrl = (sup.url || '').toLowerCase();
        if (lowerUrl.includes('shop.') || lowerUrl.includes('store.')) return true;
        return false;
    };

    const isDeepProductUrl = (url?: string): boolean => {
        if (!url || !url.trim()) return false;
        try {
            const u = new URL(url.startsWith('http') ? url : `https://${url}`);
            const cleanPath = u.pathname.replace(/^\/(de|en)?\/?$/i, '').trim();
            return cleanPath.length > 1;
        } catch {
            return false;
        }
    };

    const isProductNaturallyComplete = (p: Product): boolean => {
        const hasImage = !!(p.image && p.image.trim());
        const hasSupplier = !!p.supplierId;
        const sup = suppliers.find(s => s.id === p.supplierId);
        const needsShopLink = isSupplierWebshop(sup, p);
        const hasOrderLinkOrEmailMethod = !needsShopLink || isDeepProductUrl(p.orderUrl);
        const hasCategory = !!(p.category && p.category !== 'Sonstiges' && p.category !== 'Ohne Kategorie');
        return hasImage && hasSupplier && hasOrderLinkOrEmailMethod && hasCategory;
    };

    const isSupplierNaturallyComplete = (s: Supplier): boolean => {
        const hasValidEmail = !!(s.email && s.email.trim() && s.email !== 'hello@unbekannt.com');
        const hasUrl = !!((s.url && s.url.trim()) || (s.orderUrl && s.orderUrl.trim()));
        const hasPhone = !!(s.phone && s.phone.trim());
        if (s.preferredOrderMethod === 'phone') return hasPhone;
        return hasValidEmail && hasUrl;
    };

    const initDraftsAndState = async () => {
        const pDrafts: Record<string, ProductDraft> = {};
        for (const p of products) {
            pDrafts[p.id] = {
                id: p.id,
                name: p.name || '',
                originalName: p.name || '',
                category: p.category || 'Sonstiges',
                unit: p.unit || 'Stück',
                price: p.price || 0,
                minStock: p.minStock || 0,
                standardOrderQuantity: p.standardOrderQuantity || 0,
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

    const openProductsCount = useMemo(() => {
        return products.filter(p => !(completedProductIds.has(p.id) || isProductNaturallyComplete(p))).length;
    }, [products, suppliers, completedProductIds]);

    const openSuppliersCount = useMemo(() => {
        return suppliers.filter(s => !(completedSupplierIds.has(s.id) || isSupplierNaturallyComplete(s))).length;
    }, [suppliers, completedSupplierIds]);

    useEffect(() => {
        onCountsChange?.({ openProducts: openProductsCount, openSuppliers: openSuppliersCount });
    }, [openProductsCount, openSuppliersCount]);

    const availableCategories = useMemo(() => {
        const set = new Set([...STANDARD_CATEGORIES]);
        products.forEach(p => { if (p.category) set.add(p.category); });
        suppliers.forEach(s => { if (s.defaultCategory) set.add(s.defaultCategory); });
        return Array.from(set).filter(Boolean);
    }, [products, suppliers]);

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
                originalName: orig.name || '',
                category: orig.category || 'Sonstiges',
                unit: orig.unit || 'Stück',
                price: orig.price || 0,
                minStock: orig.minStock || 0,
                standardOrderQuantity: orig.standardOrderQuantity || 0,
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
    const startAiCompletionAndOpenReview = async (excludeIds?: Set<string>) => {
        if (!supabase || aiLoading) return;
        setAiLoading(true);
        setError(null);
        try {
            if (activeTab === 'products') {
                const availableProducts = excludeIds
                    ? filteredProducts.filter(p => !excludeIds.has(p.id))
                    : (pagedOverviewProducts.length > 0 ? pagedOverviewProducts : filteredProducts);
                const targetBatch = availableProducts.slice(0, BATCH_SIZE);
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
                        supplierId: d?.supplierId || p.supplierId || '',
                        price: d?.price ?? p.price ?? 0,
                        minStock: d?.minStock ?? p.minStock ?? 0,
                        standardOrderQuantity: d?.standardOrderQuantity ?? p.standardOrderQuantity ?? 0,
                        preferredOrderMethod: d?.preferredOrderMethod || p.preferredOrderMethod || '',
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
                    body: { action: 'suggest_completion', items: itemsPayload, categories: availableCategories }
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
                        const newSupplierId = !cur.supplierId && s.supplierId ? s.supplierId : cur.supplierId;
                        const sup = suppliers.find(supItem => supItem.id === newSupplierId);
                        const allowShopLink = !isEmailOnlySupplier(sup);

                        const validSuggestedUrl = isDeepProductUrl(s.orderUrl) ? s.orderUrl : '';
                        const newName = s.cleanName && s.cleanName !== cur.name ? s.cleanName : cur.name;
                        const newImage = !cur.image && s.image ? s.image : cur.image;
                        const newOrderUrl = allowShopLink && !cur.orderUrl && validSuggestedUrl ? validSuggestedUrl : cur.orderUrl;
                        const newProdNum = !cur.productNumber && s.productNumber ? s.productNumber : cur.productNumber;
                        const isPriceOutlier = !!(s.price && cur.price && Number(cur.price) > Number(s.price) * 2.5);
                        const newPrice = (!cur.price || Number(cur.price) === 0 || isPriceOutlier) && s.price && Number(s.price) > 0 ? Number(s.price) : cur.price;
                        const hasDefaultNoMinStock = !!sup?.defaultNoMinStock;
                        const newMinStock = hasDefaultNoMinStock && (!cur.minStock || Number(cur.minStock) === 0)
                            ? 0
                            : ((!cur.minStock || Number(cur.minStock) === 0) && s.minStock && Number(s.minStock) > 0
                                ? Number(s.minStock)
                                : cur.minStock);
                        const newStdQty = (!cur.standardOrderQuantity || Number(cur.standardOrderQuantity) === 0) && s.standardOrderQuantity && Number(s.standardOrderQuantity) > 0
                            ? Number(s.standardOrderQuantity)
                            : cur.standardOrderQuantity;
                        const newOrderMethod = newOrderUrl
                            ? 'webshop'
                            : (s.preferredOrderMethod || cur.preferredOrderMethod || (isEmailOnlySupplier(sup) ? 'email' : 'webshop'));
                        const isMismatch = (cur.category === 'Getränke' || cur.category === 'Lebensmittel') && (s.category === 'Reinigung' || s.category === 'Instandhaltung' || s.category === 'Bürobedarf');
                        const shouldUpdateCat = (!cur.category || cur.category === 'Sonstiges' || cur.category === 'Ohne Kategorie' || isMismatch) && s.category && s.category !== 'Sonstiges';
                        const newCat = shouldUpdateCat ? s.category : cur.category;
                        const newUnit = (!cur.unit || cur.unit === 'Stück' || cur.unit === 'Stk') && s.unit && s.unit !== cur.unit
                            ? s.unit
                            : cur.unit;

                        const aiFields = {
                            ...(cur.aiFields || {}),
                            name: !!(s.cleanName && s.cleanName !== cur.name) ? true : cur.aiFields?.name,
                            image: !cur.image && !!s.image ? true : cur.aiFields?.image,
                            orderUrl: allowShopLink && !cur.orderUrl && !!validSuggestedUrl ? true : cur.aiFields?.orderUrl,
                            productNumber: !cur.productNumber && !!s.productNumber ? true : cur.aiFields?.productNumber,
                            supplierId: !cur.supplierId && !!s.supplierId ? true : cur.aiFields?.supplierId,
                            price: (!cur.price || Number(cur.price) === 0 || isPriceOutlier) && !!s.price && Number(s.price) > 0 ? true : cur.aiFields?.price,
                            minStock: hasDefaultNoMinStock ? false : ((!cur.minStock || Number(cur.minStock) === 0) && !!s.minStock && Number(s.minStock) > 0 ? true : cur.aiFields?.minStock),
                            standardOrderQuantity: (!cur.standardOrderQuantity || Number(cur.standardOrderQuantity) === 0) && !!s.standardOrderQuantity && Number(s.standardOrderQuantity) > 0 ? true : cur.aiFields?.standardOrderQuantity,
                            preferredOrderMethod: newOrderMethod !== cur.preferredOrderMethod ? true : cur.aiFields?.preferredOrderMethod,
                            category: shouldUpdateCat && newCat !== cur.category ? true : cur.aiFields?.category,
                            unit: newUnit !== cur.unit ? true : cur.aiFields?.unit
                        };

                        next[s.id] = {
                            ...cur,
                            name: newName,
                            image: newImage,
                            orderUrl: newOrderUrl,
                            productNumber: newProdNum,
                            supplierId: newSupplierId,
                            price: newPrice,
                            minStock: newMinStock,
                            standardOrderQuantity: newStdQty,
                            preferredOrderMethod: newOrderMethod,
                            priceCheck: s.priceCheck || cur.priceCheck,
                            category: newCat,
                            unit: newUnit,
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
                const availableSuppliers = excludeIds
                    ? filteredSuppliers.filter(s => !excludeIds.has(s.id))
                    : (pagedOverviewSuppliers.length > 0 ? pagedOverviewSuppliers : filteredSuppliers);
                const targetBatch = availableSuppliers.slice(0, BATCH_SIZE);
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
                        customerNumber: d?.customerNumber || s.customerNumber || '',
                        preferredOrderMethod: d?.preferredOrderMethod || s.preferredOrderMethod || ''
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
                        const newMethod = cur.preferredOrderMethod || s.preferredOrderMethod || (cur.url || s.url ? 'webshop' : 'email');
                        const aiFields = {
                            ...(cur.aiFields || {}),
                            url: !cur.url && !!s.url ? true : cur.aiFields?.url,
                            email: !cur.email && !!s.email ? true : cur.aiFields?.email,
                            phone: !cur.phone && !!s.phone ? true : cur.aiFields?.phone,
                            customerNumber: !cur.customerNumber && !!s.customerNumber ? true : cur.aiFields?.customerNumber,
                            preferredOrderMethod: newMethod !== cur.preferredOrderMethod ? true : cur.aiFields?.preferredOrderMethod
                        };
                        next[s.id] = {
                            ...cur,
                            url: cur.url || s.url || '',
                            email: cur.email || s.email || '',
                            phone: cur.phone || s.phone || '',
                            customerNumber: cur.customerNumber || s.customerNumber || '',
                            preferredOrderMethod: newMethod,
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
                            preferredOrderMethod: 'webshop',
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
                min_stock: d.minStock ?? 0,
                standard_order_quantity: d.standardOrderQuantity || null,
                product_number: d.productNumber || null,
                supplier_id: d.supplierId || null,
                order_url: d.orderUrl || null,
                preferred_order_method: d.orderUrl ? 'webshop' : (d.preferredOrderMethod || null),
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

    const handleDeleteProductImage = async (productId: string, persistImmediately = false) => {
        const cur = productDrafts[productId];
        if (!cur) return;
        const removedUrl = cur.image;
        const remainingAlts = (cur.alternatives || []).filter(u => u && u !== removedUrl);
        const nextImage = remainingAlts[0] || '';

        setProductDrafts(prev => {
            const draft = prev[productId];
            if (!draft) return prev;
            return {
                ...prev,
                [productId]: {
                    ...draft,
                    image: nextImage,
                    alternatives: remainingAlts,
                    aiFields: { ...(draft.aiFields || {}), image: !!nextImage }
                }
            };
        });

        // Im Prüffenster ('review') wird erst beim Abhaken / Übernehmen gespeichert,
        // damit man mit "Zurücksetzen" jederzeit zum Originalbild zurückkehren kann.
        if (!persistImmediately || !supabase) return;
        try {
            await supabase.functions.invoke('process-inbound-mail', {
                body: {
                    action: 'save_completion',
                    products: [{
                        id: productId,
                        name: cur.name,
                        image: nextImage || null,
                        markComplete: false
                    }]
                }
            });
            if (!nextImage) {
                onSaved('Produktbild wurde gelöscht.');
            }
        } catch (err) {
            console.warn('Could not update product image:', err);
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

    const handleBulkAcceptReview = async (continueNextBatch = false) => {
        const ids = Array.from(selectedReviewIds);
        if (ids.length === 0) return;

        setError(null);
        if (continueNextBatch) {
            // Sofortige visuelle Rückmeldung ohne 1s Hängen!
            setAiLoading(true);
            setAiLoadingSeconds(0);
        } else {
            setSavingBulk(true);
        }

        try {
            if (activeTab === 'products') {
                const doneSet = new Set([...completedProductIds, ...ids]);
                const remaining = filteredProducts.filter(p => !doneSet.has(p.id));

                if (continueNextBatch && remaining.length > 0) {
                    // Erst im Hintergrund speichern und nahtlos nächste Batch laden
                    await saveProductRows(ids, true);
                    await startAiCompletionAndOpenReview(doneSet);
                    return;
                } else {
                    await saveProductRows(ids, true);
                    onSaved(`${ids.length} ${ids.length === 1 ? 'Produkt' : 'Produkte'} übernommen & als erledigt abgehakt!`);
                }
            } else {
                const doneSet = new Set([...completedSupplierIds, ...ids]);
                const remaining = filteredSuppliers.filter(s => !doneSet.has(s.id));

                if (continueNextBatch && remaining.length > 0) {
                    await saveSupplierRows(ids, true);
                    await startAiCompletionAndOpenReview(doneSet);
                    return;
                } else {
                    await saveSupplierRows(ids, true);
                    onSaved(`${ids.length} ${ids.length === 1 ? 'Lieferant' : 'Lieferanten'} übernommen & als erledigt abgehakt!`);
                }
            }
            setViewMode('overview');
        } catch (err: any) {
            setError(err?.message || 'Fehler beim Speichern.');
            setAiLoading(false);
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
                    <style>{`
                        .spin {
                            animation: agy-spin 0.85s linear infinite !important;
                        }
                        @keyframes agy-spin {
                            from { transform: rotate(0deg); }
                            to { transform: rotate(360deg); }
                        }
                        @keyframes agy-progress-indeterminate {
                            0% { transform: translateX(-100%); }
                            100% { transform: translateX(250%); }
                        }
                        @keyframes agy-pulse-glow {
                            0%, 100% { opacity: 1; }
                            50% { opacity: 0.85; }
                        }
                    `}</style>
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
                                    {aiLoading ? (
                                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                                            <Loader2 size={18} className="spin" style={{ color: '#6d28d9' }} />
                                            Nächste Artikel werden geladen... ({aiLoadingSeconds}s)
                                        </span>
                                    ) : (
                                        <>✨ KI-Vorschläge prüfen & abhaken ({reviewedIds.length})</>
                                    )}
                                </h3>
                                <p style={{ margin: '2px 0 0 0', fontSize: '13px', color: '#4c1d95' }}>
                                    {aiLoading
                                        ? getAiLoadingStatus(aiLoadingSeconds).detail
                                        : 'Schau kurz über die gefundenen Bilder & Daten – was passt, kannst du direkt rechts (oder unten gesammelt) abhaken.'}
                                </p>
                            </div>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                                type="button"
                                onClick={() => {
                                    if (selectedReviewIds.size === reviewedIds.length) {
                                        setSelectedReviewIds(new Set());
                                    } else {
                                        setSelectedReviewIds(new Set(reviewedIds));
                                    }
                                }}
                                style={{
                                    background: '#fff',
                                    border: '1px solid #c4b5fd',
                                    borderRadius: '8px',
                                    padding: '6px 12px',
                                    fontSize: '12px',
                                    fontWeight: 600,
                                    color: '#5b21b6',
                                    cursor: 'pointer'
                                }}
                            >
                                {selectedReviewIds.size === reviewedIds.length ? 'Keine wählen' : 'Alle wählen'}
                            </button>
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
                        {aiLoading ? (
                            <div style={{
                                padding: '54px 24px',
                                textAlign: 'center',
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '14px'
                            }}>
                                <div style={{
                                    width: '60px',
                                    height: '60px',
                                    borderRadius: '50%',
                                    backgroundColor: '#eef2ff',
                                    border: '2px solid #818cf8',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    boxShadow: '0 10px 25px -5px rgba(99, 102, 241, 0.3)'
                                }}>
                                    <Loader2 size={30} className="spin" style={{ color: '#4f46e5' }} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '18px', fontWeight: 800, color: '#1e1b4b', marginBottom: '6px' }}>
                                        Nächste 8 Artikel werden analysiert... ({aiLoadingSeconds}s)
                                    </div>
                                    <div style={{ fontSize: '14px', color: '#4338ca', fontWeight: 600 }}>
                                        {getAiLoadingStatus(aiLoadingSeconds).title}
                                    </div>
                                    <div style={{ fontSize: '13px', color: '#64748b', marginTop: '6px', maxWidth: '420px' }}>
                                        {getAiLoadingStatus(aiLoadingSeconds).detail}. Die neuen Vorschläge erscheinen gleich hier zur Prüfung.
                                    </div>
                                </div>
                                <div style={{
                                    height: '6px',
                                    width: '100%',
                                    maxWidth: '360px',
                                    backgroundColor: '#e0e7ff',
                                    borderRadius: '999px',
                                    overflow: 'hidden',
                                    marginTop: '4px'
                                }}>
                                    <div style={{
                                        width: '45%',
                                        height: '100%',
                                        backgroundColor: '#6366f1',
                                        borderRadius: '999px',
                                        animation: 'agy-progress-indeterminate 1.3s ease-in-out infinite'
                                    }} />
                                </div>
                            </div>
                        ) : reviewedIds.length === 0 ? (
                            <div style={{ padding: '48px', textAlign: 'center' }}>
                                <CheckCircle2 size={44} color="#16a34a" style={{ margin: '0 auto 12px auto' }} />
                                <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                    Alle Vorschläge aus diesem Durchgang sind erledigt!
                                </div>
                                <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '16px', flexWrap: 'wrap' }}>
                                    <button
                                        type="button"
                                        onClick={() => setViewMode('overview')}
                                        className="btn btn-ghost"
                                    >
                                        Zurück zur Übersicht
                                    </button>
                                    {((activeTab === 'products' ? filteredProducts.length : filteredSuppliers.length) > 0) && (
                                        <button
                                            type="button"
                                            onClick={() => startAiCompletionAndOpenReview()}
                                            disabled={aiLoading}
                                            className="btn btn-primary"
                                            style={{ background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)', border: 'none' }}
                                        >
                                            <Sparkles size={16} />
                                            ✨ Nächste {Math.min(BATCH_SIZE, activeTab === 'products' ? filteredProducts.length : filteredSuppliers.length)} mit KI prüfen →
                                        </button>
                                    )}
                                </div>
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
                                                        onClick={() => handleDeleteProductImage(p.id, false)}
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
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px', marginTop: '3px' }}>
                                                        <span style={{ fontSize: '10px', color: '#64748b', fontWeight: 600 }}>
                                                            Alternativen:
                                                        </span>
                                                        <div style={{ display: 'flex', gap: '3px', justifyContent: 'center' }}>
                                                            {d.alternatives.slice(0, 4).map((altUrl) => (
                                                                <img
                                                                    key={altUrl}
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
                                                                    title="Als Hauptbild wählen"
                                                                />
                                                            ))}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Mitte: Übersichtliche Zusammenfassung ohne Formular-Chaos */}
                                            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                    <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>
                                                        {d.name}
                                                    </span>
                                                    {d.aiFields?.name && d.originalName && d.originalName !== d.name && (
                                                        <span style={{ backgroundColor: '#f5f3ff', color: '#6d28d9', fontSize: '11px', padding: '2px 7px', borderRadius: '6px', fontWeight: 700 }}>
                                                            ✨ Name bereinigt
                                                        </span>
                                                    )}
                                                </div>
                                                {d.aiFields?.name && d.originalName && d.originalName !== d.name && (
                                                    <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                        <span>Vorher: „{d.originalName}“</span>
                                                        <button
                                                            type="button"
                                                            onClick={() => setProductDrafts(prev => ({
                                                                ...prev,
                                                                [p.id]: {
                                                                    ...prev[p.id],
                                                                    name: prev[p.id].originalName,
                                                                    aiFields: { ...(prev[p.id].aiFields || {}), name: false }
                                                                }
                                                            }))}
                                                            style={{ background: 'none', border: 'none', color: '#2563eb', fontSize: '11px', fontWeight: 600, cursor: 'pointer', padding: 0, textDecoration: 'underline' }}
                                                        >
                                                            Originalname behalten
                                                        </button>
                                                    </div>
                                                )}
                                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', fontSize: '12px', color: '#475569' }}>
                                                    <span style={{ backgroundColor: d.aiFields?.supplierId ? '#f5f3ff' : '#f1f5f9', color: d.aiFields?.supplierId ? '#6d28d9' : '#475569', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                        Lieferant: {sup?.name || 'Nicht zugeordnet'} {d.aiFields?.supplierId && '✨'}
                                                    </span>
                                                    <span style={{ backgroundColor: d.aiFields?.category ? '#f5f3ff' : '#f1f5f9', color: d.aiFields?.category ? '#6d28d9' : '#475569', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                        Kategorie: {d.category} {d.aiFields?.category && '✨'}
                                                    </span>
                                                    <span style={{ backgroundColor: d.aiFields?.preferredOrderMethod ? '#f5f3ff' : '#f1f5f9', color: d.aiFields?.preferredOrderMethod ? '#6d28d9' : '#475569', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                        Bestellweg: {d.orderUrl || d.preferredOrderMethod === 'webshop' || d.preferredOrderMethod === 'link' ? '🌐 Webshop' : d.preferredOrderMethod === 'phone' ? '📞 Telefon' : '📧 E-Mail'} {d.aiFields?.preferredOrderMethod && '✨'}
                                                    </span>
                                                    <span style={{ backgroundColor: (d.aiFields?.minStock || d.aiFields?.standardOrderQuantity) ? '#f5f3ff' : '#f1f5f9', color: (d.aiFields?.minStock || d.aiFields?.standardOrderQuantity) ? '#6d28d9' : '#475569', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                        Mindestbestand: {d.minStock || 0} {d.unit} · Bestellmenge: {d.standardOrderQuantity || 1} {d.unit} {(d.aiFields?.minStock || d.aiFields?.standardOrderQuantity) && '✨'}
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
                                                        {d.priceCheck?.status === 'warning' && Boolean(d.priceCheck.shopPrice && d.priceCheck.shopPrice > 0) && (
                                                            <button
                                                                type="button"
                                                                onClick={() => {
                                                                    const sp = Number(d.priceCheck?.shopPrice) || 0;
                                                                    if (!sp) return;
                                                                    setProductDrafts(prev => {
                                                                        const cur = prev[p.id];
                                                                        if (!cur) return prev;
                                                                        return {
                                                                            ...prev,
                                                                            [p.id]: {
                                                                                ...cur,
                                                                                price: sp,
                                                                                priceCheck: cur.priceCheck ? {
                                                                                    ...cur.priceCheck,
                                                                                    status: 'ok',
                                                                                    message: `✓ Shop-Preis übernommen (${sp.toFixed(2).replace('.', ',')} €)`
                                                                                } : undefined,
                                                                                aiFields: { ...(cur.aiFields || {}), price: true }
                                                                            }
                                                                        };
                                                                    });
                                                                }}
                                                                style={{
                                                                    padding: '2px 8px',
                                                                    borderRadius: '5px',
                                                                    border: '1px solid #b45309',
                                                                    backgroundColor: '#fef3c7',
                                                                    color: '#92400e',
                                                                    fontSize: '11px',
                                                                    fontWeight: 700,
                                                                    cursor: 'pointer',
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px'
                                                                }}
                                                                title="Falscher Preis korrigieren und echten Shop-Einzelpreis übernehmen"
                                                            >
                                                                <Sparkles size={11} /> Shop-Preis ({Number(d.priceCheck?.shopPrice || 0).toFixed(2).replace('.', ',')} €) übernehmen
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : !isWebshop ? (
                                                    <div style={{ fontSize: '12px', color: '#64748b' }}>
                                                        📧 Großhändler / E-Mail-Lieferant: Bestellung per {d.preferredOrderMethod === 'phone' ? 'Telefon' : 'E-Mail'} (kein fremder Shop-Link nötig)
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
                                                gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                                                gap: '10px'
                                            }}>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '3px' }}>Produktname</label>
                                                    <input
                                                        type="text"
                                                        value={d.name}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], name: e.target.value } }))}
                                                        className="input-field"
                                                        style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                                                    />
                                                </div>
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
                                                        {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                                    </select>
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '3px' }}>Bestellweg</label>
                                                    <select
                                                        value={d.preferredOrderMethod || (d.orderUrl ? 'webshop' : 'email')}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], preferredOrderMethod: e.target.value as any } }))}
                                                        className="input-field"
                                                        style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                                                    >
                                                        <option value="webshop">🌐 Webshop</option>
                                                        <option value="email">📧 E-Mail</option>
                                                        <option value="phone">📞 Telefon</option>
                                                    </select>
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '3px' }}>Mindestbestand ({d.unit})</label>
                                                    <input
                                                        type="number"
                                                        min={0}
                                                        value={d.minStock}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], minStock: Number(e.target.value) || 0 } }))}
                                                        className="input-field"
                                                        style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                                                    />
                                                </div>
                                                <div>
                                                    <label style={{ display: 'block', fontSize: '11px', fontWeight: 600, color: '#64748b', marginBottom: '3px' }}>Bestellmenge ({d.unit})</label>
                                                    <input
                                                        type="number"
                                                        min={1}
                                                        value={d.standardOrderQuantity}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], standardOrderQuantity: Number(e.target.value) || 1 } }))}
                                                        className="input-field"
                                                        style={{ width: '100%', padding: '6px 10px', fontSize: '12px' }}
                                                    />
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
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                <span style={{ fontSize: '15px', fontWeight: 700, color: '#0f172a' }}>{d.name}</span>
                                                <span style={{ backgroundColor: d.aiFields?.preferredOrderMethod ? '#f5f3ff' : '#f1f5f9', color: d.aiFields?.preferredOrderMethod ? '#6d28d9' : '#475569', fontSize: '11px', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                    Bestellweg: {d.preferredOrderMethod === 'webshop' || d.preferredOrderMethod === 'link' ? '🌐 Webshop' : d.preferredOrderMethod === 'phone' ? '📞 Telefon' : '📧 E-Mail'} {d.aiFields?.preferredOrderMethod && '✨'}
                                                </span>
                                                {d.aiFields?.url && d.url && (
                                                    <span style={{ backgroundColor: '#f5f3ff', color: '#6d28d9', fontSize: '11px', padding: '2px 8px', borderRadius: '6px', fontWeight: 600 }}>
                                                        ✨ Webseite gefunden
                                                    </span>
                                                )}
                                            </div>
                                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '8px' }}>
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
                                                <select
                                                    value={d.preferredOrderMethod || (d.url ? 'webshop' : 'email')}
                                                    onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], preferredOrderMethod: e.target.value as any } }))}
                                                    className="input-field"
                                                    style={{ padding: '6px 10px', fontSize: '12px' }}
                                                >
                                                    <option value="webshop">🌐 Webshop</option>
                                                    <option value="email">📧 E-Mail</option>
                                                    <option value="phone">📞 Telefon</option>
                                                </select>
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
                            disabled={aiLoading || savingBulk}
                        >
                            ← Zurück zur Übersicht
                        </button>

                        <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap' }}>
                            {aiLoading ? (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '10px 18px',
                                    borderRadius: '10px',
                                    backgroundColor: '#f5f3ff',
                                    border: '1px solid #ddd6fe',
                                    color: '#6d28d9',
                                    fontSize: '13px',
                                    fontWeight: 700
                                }}>
                                    <Loader2 size={16} className="spin" />
                                    <span>Nächste Artikel werden analysiert ({aiLoadingSeconds}s)...</span>
                                </div>
                            ) : (
                                <>
                                    {((activeTab === 'products' ? filteredProducts.length : filteredSuppliers.length) > reviewedIds.length) && (
                                        <button
                                            type="button"
                                            onClick={() => handleBulkAcceptReview(true)}
                                            disabled={savingBulk || selectedReviewIds.size === 0}
                                            style={{
                                                padding: '12px 20px',
                                                borderRadius: '10px',
                                                border: '1px solid #7c3aed',
                                                backgroundColor: '#f5f3ff',
                                                color: '#6d28d9',
                                                fontWeight: 800,
                                                fontSize: '13px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '8px'
                                            }}
                                        >
                                            <Sparkles size={16} />
                                            ✓ Übernehmen & nächste {Math.min(BATCH_SIZE, Math.max(1, (activeTab === 'products' ? filteredProducts.length : filteredSuppliers.length) - reviewedIds.length))} mit KI prüfen →
                                        </button>
                                    )}

                                    <button
                                        type="button"
                                        onClick={() => handleBulkAcceptReview(false)}
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
                                </>
                            )}
                        </div>
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
                <style>{`
                    .spin {
                        animation: agy-spin 0.85s linear infinite !important;
                    }
                    @keyframes agy-spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                    @keyframes agy-progress-indeterminate {
                        0% { transform: translateX(-100%); }
                        100% { transform: translateX(250%); }
                    }
                    @keyframes agy-pulse-glow {
                        0%, 100% { opacity: 1; }
                        50% { opacity: 0.85; }
                    }
                `}</style>
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
                        onClick={() => startAiCompletionAndOpenReview()}
                        disabled={aiLoading || (activeTab === 'products' ? filteredProducts.length === 0 : filteredSuppliers.length === 0)}
                        style={{
                            width: '100%',
                            padding: aiLoading ? '16px 24px' : '18px 24px',
                            borderRadius: '14px',
                            border: 'none',
                            background: aiLoading
                                ? 'linear-gradient(135deg, #1d4ed8 0%, #6d28d9 100%)'
                                : 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)',
                            color: '#ffffff',
                            fontSize: '18px',
                            fontWeight: 800,
                            cursor: aiLoading ? 'wait' : 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '10px',
                            boxShadow: aiLoading
                                ? '0 10px 30px -5px rgba(109, 40, 217, 0.6)'
                                : '0 10px 25px -5px rgba(124, 58, 237, 0.45)',
                            transition: 'all 0.2s ease',
                            animation: aiLoading ? 'agy-pulse-glow 2.5s ease-in-out infinite' : undefined
                        }}
                    >
                        {aiLoading ? (
                            <>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                    <Loader2 size={24} className="spin" style={{ color: '#ffffff', flexShrink: 0 }} />
                                    <span style={{ fontSize: '17px', fontWeight: 800, color: '#ffffff' }}>
                                        KI analysiert 8 Artikel ({aiLoadingSeconds}s) – {getAiLoadingStatus(aiLoadingSeconds).title}
                                    </span>
                                </div>
                                <div style={{ fontSize: '13px', color: '#c7d2fe', fontWeight: 500 }}>
                                    {getAiLoadingStatus(aiLoadingSeconds).step}: {getAiLoadingStatus(aiLoadingSeconds).detail}
                                </div>
                                <div style={{
                                    height: '6px',
                                    width: '100%',
                                    maxWidth: '520px',
                                    backgroundColor: 'rgba(255, 255, 255, 0.22)',
                                    borderRadius: '999px',
                                    overflow: 'hidden',
                                    marginTop: '2px',
                                    boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.2)'
                                }}>
                                    <div style={{
                                        width: '45%',
                                        height: '100%',
                                        backgroundColor: '#ffffff',
                                        borderRadius: '999px',
                                        animation: 'agy-progress-indeterminate 1.3s ease-in-out infinite'
                                    }} />
                                </div>
                            </>
                        ) : (
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <Sparkles size={24} />
                                <span>✨ KI Daten ergänzen lassen ({activeTab === 'products' ? filteredProducts.length : filteredSuppliers.length} offen)</span>
                            </div>
                        )}
                    </button>
                    <div style={{ marginTop: '8px', fontSize: '13px', color: '#4c1d95', fontWeight: 500 }}>
                        Ergänzt automatisch Produktbilder, Shop-Links (mit Preis-Check), Kategorien, Mindestbestand & Bestellmenge, Bestellweg (Webshop/E-Mail) und bereinigt Produktnamen – danach öffnet sich das Prüffenster zum einfachen Abhaken.
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
                    backgroundColor: '#f8fafc',
                    position: 'relative'
                }}>
                    {aiLoading && (
                        <div style={{
                            position: 'sticky',
                            top: 0,
                            zIndex: 40,
                            padding: '12px 18px',
                            marginBottom: '6px',
                            borderRadius: '12px',
                            background: 'linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%)',
                            border: '1.5px solid #c7d2fe',
                            boxShadow: '0 4px 12px -2px rgba(99, 102, 241, 0.15)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '14px'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{
                                    width: '36px',
                                    height: '36px',
                                    borderRadius: '50%',
                                    backgroundColor: '#fff',
                                    border: '1px solid #c7d2fe',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0
                                }}>
                                    <Loader2 size={20} className="spin" style={{ color: '#6366f1' }} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '13px', fontWeight: 700, color: '#1e1b4b' }}>
                                        Recherche läuft im Hintergrund ({aiLoadingSeconds}s)...
                                    </div>
                                    <div style={{ fontSize: '12px', color: '#4338ca' }}>
                                        {getAiLoadingStatus(aiLoadingSeconds).title}
                                    </div>
                                </div>
                            </div>
                            <div style={{
                                height: '6px',
                                width: '140px',
                                backgroundColor: '#e0e7ff',
                                borderRadius: '999px',
                                overflow: 'hidden',
                                flexShrink: 0
                            }}>
                                <div style={{
                                    width: '45%',
                                    height: '100%',
                                    backgroundColor: '#6366f1',
                                    borderRadius: '999px',
                                    animation: 'agy-progress-indeterminate 1.3s ease-in-out infinite'
                                }} />
                            </div>
                        </div>
                    )}
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
                                                        {(!d.minStock || d.minStock === 0) && !sup?.defaultNoMinStock && <span style={{ backgroundColor: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: '999px', fontWeight: 600 }}>Mindestbestand fehlt</span>}
                                                    </div>
                                                </div>
                                            </div>

                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                                {d.image && (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleDeleteProductImage(p.id, true)}
                                                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', fontSize: '12px', cursor: 'pointer', color: '#dc2626', fontWeight: 600 }}
                                                    >
                                                        ✕ Bild löschen
                                                    </button>
                                                )}
                                                <button
                                                    type="button"
                                                    onClick={() => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], isEditing: !prev[p.id].isEditing } }))}
                                                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: '#fff', fontSize: '12px', cursor: 'pointer', color: '#475569', fontWeight: 600 }}
                                                >
                                                    ✏️ Manuell
                                                </button>
                                                {!isCompleted ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSaveSingleRow(p.id, 'product')}
                                                        disabled={savingRowId === p.id}
                                                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', color: '#64748b', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                                                        title="Ohne KI-Ergänzung überspringen & ausblenden"
                                                    >
                                                        {savingRowId === p.id ? 'Speichert...' : 'Überspringen'}
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUnmarkComplete(p.id, 'product')}
                                                        style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: '#fff', fontSize: '11px', cursor: 'pointer' }}
                                                    >
                                                        Wieder öffnen
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {d.isEditing && (
                                            <div style={{ paddingTop: '10px', borderTop: '1px dashed var(--color-border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '8px' }}>
                                                    <input
                                                        type="text"
                                                        placeholder="Produktname"
                                                        value={d.name}
                                                        onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], name: e.target.value } }))}
                                                        className="input-field"
                                                        style={{ padding: '6px 8px', fontSize: '12px' }}
                                                    />
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
                                                        {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
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
                                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSaveSingleRow(p.id, 'product')}
                                                        disabled={savingRowId === p.id}
                                                        style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', backgroundColor: '#16a34a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
                                                    >
                                                        <CheckCircle2 size={14} /> Speichern & abschließen
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )
                    ) : (
                        pagedOverviewSuppliers.length === 0 ? (
                            <div style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                                <CheckCircle2 size={42} color="#16a34a" style={{ margin: '0 auto 12px auto' }} />
                                <div style={{ fontSize: '16px', fontWeight: 700, color: 'var(--color-text-main)' }}>
                                    Alle Lieferanten sind vollständig!
                                </div>
                            </div>
                        ) : (
                            pagedOverviewSuppliers.map(s => {
                                const d = supplierDrafts[s.id];
                                if (!d) return null;
                                const isCompleted = completedSupplierIds.has(s.id) || isSupplierNaturallyComplete(s);

                                return (
                                    <div
                                        key={s.id}
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
                                            <div>
                                                <div style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{d.name}</div>
                                                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', marginTop: '3px', fontSize: '11px', color: '#64748b' }}>
                                                    <span>{d.email || 'Keine E-Mail'}</span>
                                                    {d.url ? (
                                                        <span>· {d.url}</span>
                                                    ) : (
                                                        <span style={{ backgroundColor: '#fef3c7', color: '#92400e', padding: '1px 6px', borderRadius: '999px', fontWeight: 600 }}>Webseite fehlt</span>
                                                    )}
                                                    {!d.phone && (
                                                        <span style={{ backgroundColor: '#f1f5f9', color: '#475569', padding: '1px 6px', borderRadius: '999px', fontWeight: 600 }}>Telefon fehlt</span>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexShrink: 0 }}>
                                                <button
                                                    type="button"
                                                    onClick={() => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], isEditing: !prev[s.id].isEditing } }))}
                                                    style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: '#fff', fontSize: '12px', cursor: 'pointer', color: '#475569', fontWeight: 600 }}
                                                >
                                                    ✏️ Manuell
                                                </button>
                                                {!isCompleted ? (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSaveSingleRow(s.id, 'supplier')}
                                                        disabled={savingRowId === s.id}
                                                        style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid #e2e8f0', backgroundColor: '#f8fafc', color: '#64748b', fontSize: '11px', fontWeight: 600, cursor: 'pointer' }}
                                                        title="Ohne KI-Ergänzung überspringen & ausblenden"
                                                    >
                                                        {savingRowId === s.id ? 'Speichert...' : 'Überspringen'}
                                                    </button>
                                                ) : (
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUnmarkComplete(s.id, 'supplier')}
                                                        style={{ padding: '6px 8px', borderRadius: '6px', border: '1px solid var(--color-border)', backgroundColor: '#fff', fontSize: '11px', cursor: 'pointer' }}
                                                    >
                                                        Wieder öffnen
                                                    </button>
                                                )}
                                            </div>
                                        </div>

                                        {d.isEditing && (
                                            <div style={{ paddingTop: '10px', borderTop: '1px dashed var(--color-border)', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '8px' }}>
                                                    <input
                                                        type="url"
                                                        placeholder="Webseite (https://...)"
                                                        value={d.url}
                                                        onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], url: e.target.value } }))}
                                                        className="input-field"
                                                        style={{ padding: '6px 8px', fontSize: '12px' }}
                                                    />
                                                    <input
                                                        type="email"
                                                        placeholder="E-Mail"
                                                        value={d.email}
                                                        onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], email: e.target.value } }))}
                                                        className="input-field"
                                                        style={{ padding: '6px 8px', fontSize: '12px' }}
                                                    />
                                                    <input
                                                        type="tel"
                                                        placeholder="Telefon"
                                                        value={d.phone}
                                                        onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], phone: e.target.value } }))}
                                                        className="input-field"
                                                        style={{ padding: '6px 8px', fontSize: '12px' }}
                                                    />
                                                    <select
                                                        value={d.preferredOrderMethod || (d.url ? 'webshop' : 'email')}
                                                        onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], preferredOrderMethod: e.target.value as any } }))}
                                                        className="input-field"
                                                        style={{ padding: '6px 8px', fontSize: '12px' }}
                                                    >
                                                        <option value="webshop">🌐 Webshop</option>
                                                        <option value="email">📧 E-Mail</option>
                                                        <option value="phone">📞 Telefon</option>
                                                    </select>
                                                </div>
                                                <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleSaveSingleRow(s.id, 'supplier')}
                                                        disabled={savingRowId === s.id}
                                                        style={{ padding: '6px 14px', borderRadius: '6px', border: 'none', backgroundColor: '#16a34a', color: '#fff', fontSize: '12px', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '5px' }}
                                                    >
                                                        <CheckCircle2 size={14} /> Speichern & abschließen
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                );
                            })
                        )
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
