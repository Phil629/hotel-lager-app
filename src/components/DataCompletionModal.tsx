import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    X,
    Sparkles,
    CheckCircle2,
    ExternalLink,
    Loader2,
    Building2,
    Package,
    CheckSquare,
    Square,
    RotateCcw,
    AlertCircle,
    Edit2,
    RefreshCw
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
    'Sonstiges'
];

const KNOWN_WEBSHOP_KEYWORDS = [
    'amazon', 'hygi', 'lusini', 'reinigungsberater', 'bueromarkt', 'bueroshop24', 'office-discount',
    'otto', 'conrad', 'mediamarkt', 'saturn', 'hornbach', 'bauhaus', 'obi', 'ikea', 'galaxus',
    'staples', 'viking', 'transgourmet', 'metro', 'selgros', 'chefsculinar', 'havelprinz', 'huber',
    'hollweg', 'kaeferling', 'eofficeshop', 'zoells', 'hamburgpapier', 'porzellantreff', 'ada-cosmetics',
    'ronnefeldt', 'fixpart', 'faironto'
];

const EMAIL_ONLY_SUPPLIER_KEYWORDS = [
    'wäsche', 'waesche', 'hewo', 'getränke', 'getraenke', 'bäcker', 'baecker', 'fleischer',
    'metzger', 'obst', 'gemüse', 'gemuese', 'wäscherei', 'waescherei', 'bäckerei', 'baeckerei', 'metzgerei'
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

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const enrichedBatchRef = useRef<string>('');

    const isEmailOnlySupplier = (sup?: Supplier | null): boolean => {
        if (!sup) return false;
        const lower = `${sup.name || ''} ${sup.email || ''}`.toLowerCase();
        return EMAIL_ONLY_SUPPLIER_KEYWORDS.some(k => lower.includes(k));
    };

    const isDeepProductUrl = (url?: string): boolean => {
        if (!url || typeof url !== 'string' || !url.trim()) return false;
        try {
            const u = new URL(url.startsWith('http') ? url : `https://${url}`);
            const cleanPath = u.pathname.replace(/^\/(de|en|de-de|de_de)?\/?$/i, '').trim();
            if (cleanPath.length <= 1) return false;
            if (/^\/(index\.(html|php|asp)|home|startseite)\/?$/i.test(cleanPath)) return false;
            return true;
        } catch {
            return false;
        }
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
            const validUrl = isDeepProductUrl(p.orderUrl) ? p.orderUrl! : '';
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
                orderUrl: validUrl,
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

    useEffect(() => {
        if (!isOpen) return;
        setActiveTab(initialTab);
        enrichedBatchRef.current = '';
        initDraftsAndState();
    }, [isOpen, initialTab]);

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

    const currentBatch = useMemo(() => {
        return activeTab === 'products'
            ? filteredProducts.slice(0, BATCH_SIZE)
            : filteredSuppliers.slice(0, BATCH_SIZE);
    }, [activeTab, filteredProducts, filteredSuppliers]);

    const currentBatchIds = useMemo(() => currentBatch.map(item => item.id), [currentBatch]);

    // Automatisch alle Items des aktuellen Batches selektieren
    useEffect(() => {
        setSelectedIds(new Set(currentBatchIds));
    }, [currentBatchIds]);

    // Automatisch KI für den aktuellen Batch starten (beim Öffnen oder beim Weiterschalten zum nächsten Batch)
    useEffect(() => {
        if (!isOpen || loadingState || currentBatch.length === 0) return;
        const batchKey = `${activeTab}:${currentBatchIds.sort().join(',')}`;
        if (enrichedBatchRef.current === batchKey) return;
        enrichedBatchRef.current = batchKey;
        triggerAiForCurrentBatch(currentBatch);
    }, [isOpen, loadingState, activeTab, currentBatchIds]);

    const triggerAiForCurrentBatch = async (batchItems: (Product | Supplier)[]) => {
        if (!supabase || aiLoading || batchItems.length === 0) return;
        setAiLoading(true);
        setError(null);
        try {
            if (activeTab === 'products') {
                const prods = batchItems as Product[];
                const itemsPayload = prods.map(p => {
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
                        orderUrl: isDeepProductUrl(d?.orderUrl) ? d?.orderUrl : '',
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
                        const newSupplierId = !cur.supplierId && s.supplierId ? s.supplierId : cur.supplierId;
                        const sup = suppliers.find(supItem => supItem.id === newSupplierId);
                        const allowShopLink = !isEmailOnlySupplier(sup);

                        const newName = s.cleanName && s.cleanName !== cur.name ? s.cleanName : cur.name;
                        const newImage = !cur.image && s.image ? s.image : cur.image;
                        const validSuggestedUrl = isDeepProductUrl(s.orderUrl) ? s.orderUrl : '';
                        const newOrderUrl = allowShopLink && !cur.orderUrl && validSuggestedUrl ? validSuggestedUrl : cur.orderUrl;
                        const newProdNum = !cur.productNumber && s.productNumber ? s.productNumber : cur.productNumber;
                        const isPriceOutlier = !!(s.price && cur.price && Number(cur.price) > Number(s.price) * 2.5);
                        const newPrice = (!cur.price || Number(cur.price) === 0 || isPriceOutlier) && s.price && Number(s.price) > 0 ? Number(s.price) : cur.price;
                        const newMinStock = (!cur.minStock || Number(cur.minStock) === 0) && s.minStock && Number(s.minStock) > 0
                            ? Number(s.minStock)
                            : cur.minStock;
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
                            minStock: (!cur.minStock || Number(cur.minStock) === 0) && !!s.minStock && Number(s.minStock) > 0 ? true : cur.aiFields?.minStock,
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
            } else {
                const sups = batchItems as Supplier[];
                const itemsPayload = sups.map(s => {
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

                setSupplierDrafts(prev => {
                    const next = { ...prev };
                    for (const s of suggestions) {
                        const cur = next[s.id];
                        if (!cur) continue;
                        const newUrl = !cur.url && s.url ? s.url : cur.url;
                        const newEmail = (!cur.email || cur.email === 'hello@unbekannt.com') && s.email ? s.email : cur.email;
                        const newPhone = !cur.phone && s.phone ? s.phone : cur.phone;
                        const newMethod = s.preferredOrderMethod || cur.preferredOrderMethod || (newUrl ? 'webshop' : 'email');

                        const aiFields = {
                            ...(cur.aiFields || {}),
                            url: !cur.url && !!s.url ? true : cur.aiFields?.url,
                            email: (!cur.email || cur.email === 'hello@unbekannt.com') && !!s.email ? true : cur.aiFields?.email,
                            phone: !cur.phone && !!s.phone ? true : cur.aiFields?.phone,
                            preferredOrderMethod: newMethod !== cur.preferredOrderMethod ? true : cur.aiFields?.preferredOrderMethod
                        };

                        next[s.id] = {
                            ...cur,
                            url: newUrl,
                            email: newEmail,
                            phone: newPhone,
                            preferredOrderMethod: newMethod,
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

    const revertProductDraft = (productId: string) => {
        const orig = products.find(p => p.id === productId);
        if (!orig) return;
        const validUrl = isDeepProductUrl(orig.orderUrl) ? orig.orderUrl! : '';
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
                orderUrl: validUrl,
                image: orig.image || '',
                preferredOrderMethod: orig.preferredOrderMethod,
                alternatives: orig.image ? [orig.image] : [],
                aiSuggested: false,
                isEditing: false,
                aiFields: {},
                priceCheck: undefined
            }
        }));
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
                const extractedUrl = isDeepProductUrl(data.orderUrl) ? data.orderUrl : (isDeepProductUrl(rawUrl) ? rawUrl.trim() : '');
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
                            orderUrl: extractedUrl || cur.orderUrl,
                            preferredOrderMethod: extractedUrl ? 'webshop' : cur.preferredOrderMethod,
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

    const handleDeleteProductImage = async (productId: string) => {
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
    };

    const saveProductRows = async (idsToSave: string[], markComplete = true) => {
        if (!supabase || idsToSave.length === 0) return;
        const payloadProducts = idsToSave.map(id => {
            const d = productDrafts[id];
            const validOrderUrl = isDeepProductUrl(d.orderUrl) ? d.orderUrl : null;
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
                order_url: validOrderUrl,
                preferred_order_method: validOrderUrl ? 'webshop' : (d.preferredOrderMethod || null),
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
            setSelectedIds(prev => {
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
            setSelectedIds(prev => {
                const next = new Set(prev);
                idsToSave.forEach(id => next.delete(id));
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

    const handleBulkAccept = async () => {
        setSavingBulk(true);
        setError(null);
        try {
            const ids = Array.from(selectedIds);
            if (ids.length === 0) return;
            if (activeTab === 'products') {
                await saveProductRows(ids, true);
                onSaved(`${ids.length} ${ids.length === 1 ? 'Produkt' : 'Produkte'} übernommen & als erledigt abgehakt!`);
            } else {
                await saveSupplierRows(ids, true);
                onSaved(`${ids.length} ${ids.length === 1 ? 'Lieferant' : 'Lieferanten'} übernommen & als erledigt abgehakt!`);
            }
            // Hinweis: Nach saveProductRows werden die IDs zu completedProductIds hinzugefügt.
            // filteredProducts aktualisiert sich automatisch und der nächste Batch wird direkt geladen!
        } catch (err: any) {
            setError(err?.message || 'Fehler beim Speichern.');
        } finally {
            setSavingBulk(false);
        }
    };

    if (!isOpen) return null;

    const totalProducts = products.length;
    const completedProductsCount = totalProducts - openProductsCount;
    const productProgressPercent = totalProducts > 0 ? Math.round((completedProductsCount / totalProducts) * 100) : 100;

    const totalSuppliers = suppliers.length;
    const completedSuppliersCount = totalSuppliers - openSuppliersCount;
    const supplierProgressPercent = totalSuppliers > 0 ? Math.round((completedSuppliersCount / totalSuppliers) * 100) : 100;

    const activeProgressPercent = activeTab === 'products' ? productProgressPercent : supplierProgressPercent;
    const activeOpenCount = activeTab === 'products' ? openProductsCount : openSuppliersCount;
    const activeTotalCount = activeTab === 'products' ? totalProducts : totalSuppliers;
    const activeCompletedCount = activeTab === 'products' ? completedProductsCount : completedSuppliersCount;

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
                    borderRadius: '20px',
                    width: '100%',
                    maxWidth: '980px',
                    maxHeight: '92vh',
                    display: 'flex',
                    flexDirection: 'column',
                    boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.35)',
                    border: '1px solid #c4b5fd',
                    overflow: 'hidden'
                }}
                onClick={e => e.stopPropagation()}
            >
                {/* 1. Kompakter, eleganter Header */}
                <div style={{
                    padding: '16px 24px',
                    borderBottom: '1px solid #e2e8f0',
                    background: 'linear-gradient(135deg, #f8fafc 0%, #f5f3ff 100%)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px',
                    flexWrap: 'wrap'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <div style={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '12px',
                            background: 'linear-gradient(135deg, #3b82f6 0%, #7c3aed 100%)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            boxShadow: '0 4px 12px rgba(124, 58, 237, 0.3)'
                        }}>
                            <Sparkles size={20} />
                        </div>
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 800, color: '#1e1b4b' }}>
                                    ✨ KI-Datenvervollständigung
                                </h3>
                                <span style={{
                                    backgroundColor: activeOpenCount > 0 ? '#ede9fe' : '#dcfce7',
                                    color: activeOpenCount > 0 ? '#6d28d9' : '#15803d',
                                    padding: '2px 8px',
                                    borderRadius: '999px',
                                    fontSize: '11px',
                                    fontWeight: 700
                                }}>
                                    {activeOpenCount > 0 ? `${activeOpenCount} offen` : '✓ Alles erledigt'}
                                </span>
                            </div>
                            <p style={{ margin: '2px 0 0 0', fontSize: '12px', color: '#64748b' }}>
                                Bilder, Kategorien, Mindestbestand & Bestellwege prüfen und mit 1 Klick übernehmen.
                            </p>
                        </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {/* Tabs: Produkte / Lieferanten */}
                        <div style={{ display: 'flex', backgroundColor: '#e2e8f0', borderRadius: '10px', padding: '3px', gap: '2px' }}>
                            <button
                                type="button"
                                onClick={() => setActiveTab('products')}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    backgroundColor: activeTab === 'products' ? '#fff' : 'transparent',
                                    color: activeTab === 'products' ? '#1e1b4b' : '#64748b',
                                    fontWeight: activeTab === 'products' ? 700 : 500,
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    boxShadow: activeTab === 'products' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                }}
                            >
                                <Package size={14} /> Produkte ({openProductsCount})
                            </button>
                            <button
                                type="button"
                                onClick={() => setActiveTab('suppliers')}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    backgroundColor: activeTab === 'suppliers' ? '#fff' : 'transparent',
                                    color: activeTab === 'suppliers' ? '#1e1b4b' : '#64748b',
                                    fontWeight: activeTab === 'suppliers' ? 700 : 500,
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    boxShadow: activeTab === 'suppliers' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none'
                                }}
                            >
                                <Building2 size={14} /> Lieferanten ({openSuppliersCount})
                            </button>
                        </div>

                        <label style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#64748b', cursor: 'pointer', userSelect: 'none' }}>
                            <input
                                type="checkbox"
                                checked={showCompleted}
                                onChange={e => setShowCompleted(e.target.checked)}
                            />
                            Erledigte
                        </label>

                        <button
                            onClick={onClose}
                            style={{
                                background: '#fff',
                                border: '1px solid #cbd5e1',
                                borderRadius: '8px',
                                padding: '6px',
                                cursor: 'pointer',
                                color: '#475569',
                                display: 'flex'
                            }}
                            title="Schließen"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* 2. Dynamische Fortschritts- & Steuerungs-Leiste */}
                <div style={{
                    padding: '12px 24px',
                    backgroundColor: '#ffffff',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: '16px',
                    flexWrap: 'wrap'
                }}>
                    {/* Fortschrittsanzeige */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: '260px', flex: '1 1 auto' }}>
                        <div style={{ flex: 1, backgroundColor: '#f1f5f9', borderRadius: '999px', height: '8px', overflow: 'hidden' }}>
                            <div style={{
                                width: `${activeProgressPercent}%`,
                                height: '100%',
                                background: 'linear-gradient(90deg, #3b82f6 0%, #10b981 100%)',
                                borderRadius: '999px',
                                transition: 'width 0.4s ease'
                            }} />
                        </div>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: '#334155', whiteSpace: 'nowrap' }}>
                            {activeCompletedCount} von {activeTotalCount} ({activeProgressPercent}%)
                        </span>
                    </div>

                    {/* Batch-Status & Schnellauswahl */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        {aiLoading ? (
                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#7c3aed', fontWeight: 600 }}>
                                <Loader2 size={15} className="spin" /> KI sucht Bilder & Daten...
                            </span>
                        ) : currentBatch.length > 0 ? (
                            <button
                                type="button"
                                onClick={() => triggerAiForCurrentBatch(currentBatch)}
                                style={{
                                    padding: '5px 10px',
                                    borderRadius: '8px',
                                    border: '1px solid #ddd6fe',
                                    backgroundColor: '#f5f3ff',
                                    color: '#6d28d9',
                                    fontSize: '11px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '5px'
                                }}
                                title="KI-Suche für diesen Durchgang erneut starten"
                            >
                                <RefreshCw size={12} /> Neu suchen
                            </button>
                        ) : null}

                        {currentBatch.length > 0 && (
                            <button
                                type="button"
                                onClick={() => {
                                    if (selectedIds.size === currentBatchIds.length) {
                                        setSelectedIds(new Set());
                                    } else {
                                        setSelectedIds(new Set(currentBatchIds));
                                    }
                                }}
                                style={{
                                    padding: '5px 10px',
                                    borderRadius: '8px',
                                    border: '1px solid #cbd5e1',
                                    backgroundColor: '#fff',
                                    color: '#475569',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    cursor: 'pointer'
                                }}
                            >
                                {selectedIds.size === currentBatchIds.length ? 'Keine wählen' : 'Alle wählen'}
                            </button>
                        )}

                        <button
                            type="button"
                            onClick={handleBulkAccept}
                            disabled={savingBulk || aiLoading || selectedIds.size === 0}
                            style={{
                                padding: '8px 18px',
                                borderRadius: '10px',
                                border: 'none',
                                background: 'linear-gradient(135deg, #16a34a 0%, #15803d 100%)',
                                color: '#fff',
                                fontWeight: 800,
                                fontSize: '13px',
                                cursor: (savingBulk || aiLoading || selectedIds.size === 0) ? 'not-allowed' : 'pointer',
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: '7px',
                                opacity: selectedIds.size === 0 ? 0.6 : 1,
                                boxShadow: selectedIds.size > 0 ? '0 4px 12px rgba(22, 163, 74, 0.3)' : 'none',
                                transition: 'all 0.2s ease'
                            }}
                        >
                            {savingBulk ? (
                                <>
                                    <Loader2 size={16} className="spin" /> Übernehme...
                                </>
                            ) : (
                                <>
                                    <CheckCircle2 size={16} /> ✓ Alle {selectedIds.size} übernehmen & weiter
                                </>
                            )}
                        </button>
                    </div>
                </div>

                {error && (
                    <div style={{ margin: '12px 24px 0 24px', padding: '10px 14px', borderRadius: '8px', backgroundColor: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c', fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <AlertCircle size={16} /> {error}
                    </div>
                )}

                {/* 3. Der Haupt-Kartenbereich */}
                <div style={{
                    padding: '16px 24px',
                    overflowY: 'auto',
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                    backgroundColor: '#f8fafc'
                }}>
                    {loadingState ? (
                        <div style={{ padding: '60px', textAlign: 'center', color: '#64748b' }}>
                            <Loader2 size={32} className="spin" style={{ margin: '0 auto 12px auto', color: '#7c3aed' }} />
                            Lade Daten...
                        </div>
                    ) : currentBatch.length === 0 ? (
                        // ERFOLGS-STATUS: Alles erledigt!
                        <div style={{
                            padding: '60px 24px',
                            textAlign: 'center',
                            backgroundColor: '#fff',
                            borderRadius: '16px',
                            border: '1px solid #bbf7d0',
                            boxShadow: '0 4px 12px rgba(0,0,0,0.03)'
                        }}>
                            <div style={{
                                width: '64px',
                                height: '64px',
                                borderRadius: '999px',
                                backgroundColor: '#dcfce7',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                margin: '0 auto 16px auto',
                                color: '#16a34a'
                            }}>
                                <CheckCircle2 size={36} />
                            </div>
                            <h4 style={{ margin: '0 0 6px 0', fontSize: '20px', fontWeight: 800, color: '#14532d' }}>
                                🎉 Fantastisch! Alle {activeTab === 'products' ? 'Produkte' : 'Lieferanten'} sind vollständig.
                            </h4>
                            <p style={{ margin: '0 auto 20px auto', fontSize: '13px', color: '#166534', maxWidth: '480px' }}>
                                {activeTab === 'products'
                                    ? 'Alle Produkte haben saubere Namen, zugeordnete Kategorien, hochauflösende Bilder und korrekte Bestellwege.'
                                    : 'Alle Lieferanten haben Webseiten, Kontaktdaten und bevorzugte Bestellwege hinterlegt.'}
                            </p>
                            <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', flexWrap: 'wrap' }}>
                                {activeTab === 'products' && openSuppliersCount > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setActiveTab('suppliers')}
                                        className="btn btn-primary"
                                        style={{ background: 'linear-gradient(135deg, #2563eb 0%, #7c3aed 100%)', border: 'none' }}
                                    >
                                        <Building2 size={16} /> Jetzt offene Lieferanten prüfen ({openSuppliersCount}) →
                                    </button>
                                )}
                                <button
                                    type="button"
                                    onClick={onClose}
                                    className="btn btn-ghost"
                                    style={{ border: '1px solid #cbd5e1' }}
                                >
                                    Fenster schließen
                                </button>
                            </div>
                        </div>
                    ) : activeTab === 'products' ? (
                        (currentBatch as Product[]).map(p => {
                            const d = productDrafts[p.id];
                            if (!d) return null;
                            const isChecked = selectedIds.has(p.id);
                            const sup = suppliers.find(s => s.id === d.supplierId);
                            const isWebshop = isSupplierWebshop(sup, d);
                            const isDone = completedProductIds.has(p.id) || isProductNaturallyComplete(p);

                            return (
                                <div
                                    key={p.id}
                                    style={{
                                        backgroundColor: '#ffffff',
                                        borderRadius: '14px',
                                        padding: '14px 18px',
                                        border: isChecked ? '2px solid #7c3aed' : '1px solid #e2e8f0',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '12px',
                                        boxShadow: isChecked ? '0 4px 14px rgba(124, 58, 237, 0.08)' : '0 2px 6px rgba(0,0,0,0.03)',
                                        transition: 'all 0.15s ease'
                                    }}
                                >
                                    <div style={{
                                        display: 'grid',
                                        gridTemplateColumns: '26px 84px 1fr auto',
                                        gap: '16px',
                                        alignItems: 'center'
                                    }}>
                                        {/* 1. Checkbox */}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                setSelectedIds(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(p.id)) next.delete(p.id);
                                                    else next.add(p.id);
                                                    return next;
                                                });
                                            }}
                                            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: isChecked ? '#7c3aed' : '#cbd5e1' }}
                                        >
                                            {isChecked ? <CheckSquare size={22} /> : <Square size={22} />}
                                        </button>

                                        {/* 2. Bild mit Alternativen & Löschen */}
                                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px' }}>
                                            <div style={{
                                                width: '74px',
                                                height: '74px',
                                                borderRadius: '10px',
                                                border: '1px solid #e2e8f0',
                                                backgroundColor: '#f8fafc',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'center',
                                                overflow: 'hidden',
                                                position: 'relative'
                                            }}>
                                                {d.image ? (
                                                    <img src={d.image} alt={d.name} style={{ width: '100%', height: '100%', objectFit: 'contain', backgroundColor: '#fff' }} />
                                                ) : aiLoading ? (
                                                    <Loader2 size={18} className="spin" color="#7c3aed" />
                                                ) : (
                                                    <span style={{ fontSize: '10px', color: '#94a3b8', textAlign: 'center' }}>Kein Bild</span>
                                                )}
                                            </div>

                                            {d.image && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleDeleteProductImage(p.id)}
                                                    style={{
                                                        padding: '2px 6px',
                                                        borderRadius: '5px',
                                                        border: '1px solid #fecaca',
                                                        backgroundColor: '#fef2f2',
                                                        color: '#dc2626',
                                                        fontSize: '10px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        display: 'flex',
                                                        alignItems: 'center',
                                                        gap: '2px'
                                                    }}
                                                >
                                                    <X size={10} /> Löschen
                                                </button>
                                            )}

                                            {d.alternatives && d.alternatives.length > 1 && (
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
                                                                width: '18px',
                                                                height: '18px',
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

                                        {/* 3. Produkt-Details mit KI-Badges */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>
                                                    {d.name}
                                                </span>
                                                {d.aiFields?.name && d.originalName && d.originalName !== d.name && (
                                                    <span style={{ backgroundColor: '#ede9fe', color: '#6d28d9', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                                        ✨ Name bereinigt
                                                    </span>
                                                )}
                                                {d.aiFields?.image && (
                                                    <span style={{ backgroundColor: '#ede9fe', color: '#6d28d9', fontSize: '10px', padding: '1px 6px', borderRadius: '4px', fontWeight: 700 }}>
                                                        ✨ Bild gefunden
                                                    </span>
                                                )}
                                            </div>

                                            {d.aiFields?.name && d.originalName && d.originalName !== d.name && (
                                                <div style={{ fontSize: '11px', color: '#64748b', display: 'flex', alignItems: 'center', gap: '6px' }}>
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

                                            {isDone && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                    <span style={{ backgroundColor: '#dcfce7', color: '#15803d', fontSize: '11px', padding: '2px 8px', borderRadius: '6px', fontWeight: 700 }}>
                                                        ✓ Bereits erledigt
                                                    </span>
                                                    <button
                                                        type="button"
                                                        onClick={() => handleUnmarkComplete(p.id, 'product')}
                                                        style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                                                    >
                                                        Wieder öffnen
                                                    </button>
                                                </div>
                                            )}

                                            {/* Info-Badges */}
                                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap', alignItems: 'center', fontSize: '11px', color: '#475569' }}>
                                                <span style={{ backgroundColor: d.aiFields?.supplierId ? '#ede9fe' : '#f1f5f9', color: d.aiFields?.supplierId ? '#6d28d9' : '#475569', padding: '2px 7px', borderRadius: '6px', fontWeight: 600 }}>
                                                    {sup?.name || 'Lieferant fehlt'} {d.aiFields?.supplierId && '✨'}
                                                </span>
                                                <span style={{ backgroundColor: d.aiFields?.category ? '#ede9fe' : '#f1f5f9', color: d.aiFields?.category ? '#6d28d9' : '#475569', padding: '2px 7px', borderRadius: '6px', fontWeight: 600 }}>
                                                    {d.category} {d.aiFields?.category && '✨'}
                                                </span>
                                                <span style={{ backgroundColor: d.aiFields?.preferredOrderMethod ? '#ede9fe' : '#f1f5f9', color: d.aiFields?.preferredOrderMethod ? '#6d28d9' : '#475569', padding: '2px 7px', borderRadius: '6px', fontWeight: 600 }}>
                                                    {d.orderUrl ? '🌐 Webshop' : d.preferredOrderMethod === 'phone' ? '📞 Telefon' : '📧 E-Mail'} {d.aiFields?.preferredOrderMethod && '✨'}
                                                </span>
                                                <span style={{ backgroundColor: (d.aiFields?.minStock || d.aiFields?.standardOrderQuantity) ? '#ede9fe' : '#f1f5f9', color: (d.aiFields?.minStock || d.aiFields?.standardOrderQuantity) ? '#6d28d9' : '#475569', padding: '2px 7px', borderRadius: '6px', fontWeight: 600 }}>
                                                    Min: {d.minStock || 0} {d.unit} · Best: {d.standardOrderQuantity || 1} {d.unit} {(d.aiFields?.minStock || d.aiFields?.standardOrderQuantity) && '✨'}
                                                </span>
                                                {d.price > 0 && (
                                                    <span style={{ backgroundColor: d.aiFields?.price ? '#ede9fe' : '#f1f5f9', color: d.aiFields?.price ? '#6d28d9' : '#475569', padding: '2px 7px', borderRadius: '6px', fontWeight: 600 }}>
                                                        {Number(d.price).toFixed(2).replace('.', ',')} € {d.aiFields?.price && '✨'}
                                                    </span>
                                                )}
                                            </div>

                                            {/* Link-Zeile: Echter Shop-Link vs Großhändler */}
                                            {isDeepProductUrl(d.orderUrl) ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', fontSize: '11px' }}>
                                                    <a
                                                        href={d.orderUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        style={{ color: '#2563eb', fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: '4px', textDecoration: 'none' }}
                                                    >
                                                        <ExternalLink size={12} /> Gefundener Shop-Link prüfen
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
                                                            padding: '1px 6px',
                                                            borderRadius: '4px',
                                                            fontSize: '10px',
                                                            fontWeight: 600,
                                                            backgroundColor: d.priceCheck.status === 'warning' ? '#fffbeb' : '#f0fdf4',
                                                            color: d.priceCheck.status === 'warning' ? '#b45309' : '#15803d',
                                                            border: d.priceCheck.status === 'warning' ? '1px solid #fcd34d' : '1px solid #bbf7d0'
                                                        }}>
                                                            {d.priceCheck.message}
                                                        </span>
                                                    )}
                                                    {d.priceCheck?.status === 'warning' && d.priceCheck.shopPrice && d.priceCheck.shopPrice > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={() => {
                                                                const sp = d.priceCheck!.shopPrice!;
                                                                setProductDrafts(prev => ({
                                                                    ...prev,
                                                                    [p.id]: {
                                                                        ...prev[p.id],
                                                                        price: sp,
                                                                        priceCheck: {
                                                                            ...prev[p.id].priceCheck!,
                                                                            status: 'ok',
                                                                            message: `✓ Shop-Preis übernommen (${sp.toFixed(2).replace('.', ',')} €)`
                                                                        },
                                                                        aiFields: { ...(prev[p.id].aiFields || {}), price: true }
                                                                    }
                                                                }));
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
                                                            <Sparkles size={11} /> Shop-Preis ({d.priceCheck.shopPrice.toFixed(2).replace('.', ',')} €) übernehmen
                                                        </button>
                                                    )}
                                                </div>
                                            ) : !isWebshop ? (
                                                <div style={{ fontSize: '11px', color: '#64748b' }}>
                                                    📧 Großhändler: Bestellung per E-Mail/Telefon (kein Online-Shop nötig)
                                                </div>
                                            ) : (
                                                <div style={{ fontSize: '11px', color: '#b45309' }}>
                                                    ⚠️ Kein direkter Produktlink im Shop gefunden – klicke auf „Ändern“, um einen Link einzufügen.
                                                </div>
                                            )}
                                        </div>

                                        {/* 4. Aktionen pro Zeile */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <button
                                                type="button"
                                                onClick={() => setProductDrafts(prev => ({
                                                    ...prev,
                                                    [p.id]: { ...prev[p.id], isEditing: !prev[p.id].isEditing }
                                                }))}
                                                style={{
                                                    padding: '7px 11px',
                                                    borderRadius: '8px',
                                                    border: '1px solid #cbd5e1',
                                                    backgroundColor: '#fff',
                                                    color: '#334155',
                                                    fontSize: '12px',
                                                    fontWeight: 600,
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px'
                                                }}
                                                title="Manuell anpassen"
                                            >
                                                <Edit2 size={12} /> Ändern
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => revertProductDraft(p.id)}
                                                style={{
                                                    padding: '7px 9px',
                                                    borderRadius: '8px',
                                                    border: '1px solid #fecaca',
                                                    backgroundColor: '#fef2f2',
                                                    color: '#dc2626',
                                                    fontSize: '12px',
                                                    cursor: 'pointer'
                                                }}
                                                title="Vorschlag ablehnen & zurücksetzen"
                                            >
                                                <RotateCcw size={13} />
                                            </button>

                                            <button
                                                type="button"
                                                onClick={() => handleSaveSingleRow(p.id, 'product')}
                                                disabled={savingRowId === p.id}
                                                style={{
                                                    padding: '8px 14px',
                                                    borderRadius: '8px',
                                                    border: 'none',
                                                    backgroundColor: '#16a34a',
                                                    color: '#fff',
                                                    fontWeight: 700,
                                                    fontSize: '12px',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '5px',
                                                    whiteSpace: 'nowrap'
                                                }}
                                            >
                                                {savingRowId === p.id ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />}
                                                ✓ Abhaken
                                            </button>
                                        </div>
                                    </div>

                                    {/* Aufklappbarer Editor bei Klick auf "Ändern" */}
                                    {d.isEditing && (
                                        <div style={{
                                            marginTop: '4px',
                                            paddingTop: '12px',
                                            borderTop: '1px dashed #e2e8f0',
                                            display: 'grid',
                                            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
                                            gap: '8px'
                                        }}>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#64748b', marginBottom: '2px' }}>Name</label>
                                                <input
                                                    type="text"
                                                    value={d.name}
                                                    onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], name: e.target.value } }))}
                                                    className="input-field"
                                                    style={{ width: '100%', padding: '5px 8px', fontSize: '12px' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#64748b', marginBottom: '2px' }}>Lieferant</label>
                                                <select
                                                    value={d.supplierId}
                                                    onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], supplierId: e.target.value } }))}
                                                    className="input-field"
                                                    style={{ width: '100%', padding: '5px 8px', fontSize: '12px' }}
                                                >
                                                    <option value="">-- Keiner --</option>
                                                    {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#64748b', marginBottom: '2px' }}>Kategorie</label>
                                                <select
                                                    value={d.category}
                                                    onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], category: e.target.value } }))}
                                                    className="input-field"
                                                    style={{ width: '100%', padding: '5px 8px', fontSize: '12px' }}
                                                >
                                                    {availableCategories.map(c => <option key={c} value={c}>{c}</option>)}
                                                </select>
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#64748b', marginBottom: '2px' }}>Bestellweg</label>
                                                <select
                                                    value={d.preferredOrderMethod || (d.orderUrl ? 'webshop' : 'email')}
                                                    onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], preferredOrderMethod: e.target.value as any } }))}
                                                    className="input-field"
                                                    style={{ width: '100%', padding: '5px 8px', fontSize: '12px' }}
                                                >
                                                    <option value="webshop">🌐 Webshop</option>
                                                    <option value="email">📧 E-Mail</option>
                                                    <option value="phone">📞 Telefon</option>
                                                </select>
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#64748b', marginBottom: '2px' }}>Min-Bestand ({d.unit})</label>
                                                <input
                                                    type="number"
                                                    min={0}
                                                    value={d.minStock}
                                                    onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], minStock: Number(e.target.value) || 0 } }))}
                                                    className="input-field"
                                                    style={{ width: '100%', padding: '5px 8px', fontSize: '12px' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#64748b', marginBottom: '2px' }}>Bestellmenge ({d.unit})</label>
                                                <input
                                                    type="number"
                                                    min={1}
                                                    value={d.standardOrderQuantity}
                                                    onChange={e => setProductDrafts(prev => ({ ...prev, [p.id]: { ...prev[p.id], standardOrderQuantity: Number(e.target.value) || 1 } }))}
                                                    className="input-field"
                                                    style={{ width: '100%', padding: '5px 8px', fontSize: '12px' }}
                                                />
                                            </div>
                                            <div>
                                                <label style={{ display: 'block', fontSize: '10px', fontWeight: 600, color: '#64748b', marginBottom: '2px' }}>Shop-Link (lädt Bild)</label>
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
                                                    style={{ width: '100%', padding: '5px 8px', fontSize: '12px' }}
                                                />
                                            </div>
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    ) : (
                        // LIEFERANTEN-KARTEN
                        (currentBatch as Supplier[]).map(s => {
                            const d = supplierDrafts[s.id];
                            if (!d) return null;
                            const isChecked = selectedIds.has(s.id);
                            const isDone = completedSupplierIds.has(s.id) || isSupplierNaturallyComplete(s);

                            return (
                                <div
                                    key={s.id}
                                    style={{
                                        backgroundColor: '#ffffff',
                                        borderRadius: '14px',
                                        padding: '14px 18px',
                                        border: isChecked ? '2px solid #7c3aed' : '1px solid #e2e8f0',
                                        display: 'grid',
                                        gridTemplateColumns: '26px 1fr auto',
                                        gap: '16px',
                                        alignItems: 'center',
                                        boxShadow: isChecked ? '0 4px 14px rgba(124, 58, 237, 0.08)' : '0 2px 6px rgba(0,0,0,0.03)'
                                    }}
                                >
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setSelectedIds(prev => {
                                                const next = new Set(prev);
                                                if (next.has(s.id)) next.delete(s.id);
                                                else next.add(s.id);
                                                return next;
                                            });
                                        }}
                                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: isChecked ? '#7c3aed' : '#cbd5e1' }}
                                    >
                                        {isChecked ? <CheckSquare size={22} /> : <Square size={22} />}
                                    </button>

                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                            <span style={{ fontSize: '14px', fontWeight: 700, color: '#0f172a' }}>{d.name}</span>
                                            <span style={{ backgroundColor: d.aiFields?.preferredOrderMethod ? '#ede9fe' : '#f1f5f9', color: d.aiFields?.preferredOrderMethod ? '#6d28d9' : '#475569', fontSize: '11px', padding: '2px 7px', borderRadius: '6px', fontWeight: 600 }}>
                                                Bestellweg: {d.preferredOrderMethod === 'webshop' || d.preferredOrderMethod === 'link' ? '🌐 Webshop' : d.preferredOrderMethod === 'phone' ? '📞 Telefon' : '📧 E-Mail'} {d.aiFields?.preferredOrderMethod && '✨'}
                                            </span>
                                            {d.aiFields?.url && d.url && (
                                                <span style={{ backgroundColor: '#ede9fe', color: '#6d28d9', fontSize: '11px', padding: '2px 7px', borderRadius: '6px', fontWeight: 600 }}>
                                                    ✨ Webseite ergänzt
                                                </span>
                                            )}
                                            {isDone && (
                                                <span style={{ backgroundColor: '#dcfce7', color: '#15803d', fontSize: '11px', padding: '2px 7px', borderRadius: '6px', fontWeight: 700 }}>
                                                    ✓ Bereits erledigt
                                                </span>
                                            )}
                                            {isDone && (
                                                <button
                                                    type="button"
                                                    onClick={() => handleUnmarkComplete(s.id, 'supplier')}
                                                    style={{ background: 'none', border: 'none', color: '#64748b', fontSize: '11px', cursor: 'pointer', textDecoration: 'underline' }}
                                                >
                                                    Wieder öffnen
                                                </button>
                                            )}
                                        </div>

                                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '8px' }}>
                                            <input
                                                type="url"
                                                placeholder="Webseite (https://...)"
                                                value={d.url}
                                                onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], url: e.target.value } }))}
                                                className="input-field"
                                                style={{ padding: '5px 8px', fontSize: '12px' }}
                                            />
                                            <input
                                                type="email"
                                                placeholder="E-Mail"
                                                value={d.email}
                                                onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], email: e.target.value } }))}
                                                className="input-field"
                                                style={{ padding: '5px 8px', fontSize: '12px' }}
                                            />
                                            <input
                                                type="tel"
                                                placeholder="Telefon"
                                                value={d.phone}
                                                onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], phone: e.target.value } }))}
                                                className="input-field"
                                                style={{ padding: '5px 8px', fontSize: '12px' }}
                                            />
                                            <select
                                                value={d.preferredOrderMethod || (d.url ? 'webshop' : 'email')}
                                                onChange={e => setSupplierDrafts(prev => ({ ...prev, [s.id]: { ...prev[s.id], preferredOrderMethod: e.target.value as any } }))}
                                                className="input-field"
                                                style={{ padding: '5px 8px', fontSize: '12px' }}
                                            >
                                                <option value="webshop">🌐 Webshop</option>
                                                <option value="email">📧 E-Mail</option>
                                                <option value="phone">📞 Telefon</option>
                                            </select>
                                        </div>
                                    </div>

                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        <button
                                            type="button"
                                            onClick={() => revertSupplierDraft(s.id)}
                                            style={{ padding: '7px 9px', borderRadius: '8px', border: '1px solid #fecaca', backgroundColor: '#fef2f2', color: '#dc2626', cursor: 'pointer' }}
                                            title="Zurücksetzen"
                                        >
                                            <RotateCcw size={13} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleSaveSingleRow(s.id, 'supplier')}
                                            disabled={savingRowId === s.id}
                                            style={{
                                                padding: '8px 14px',
                                                borderRadius: '8px',
                                                border: 'none',
                                                backgroundColor: '#16a34a',
                                                color: '#fff',
                                                fontWeight: 700,
                                                fontSize: '12px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '5px'
                                            }}
                                        >
                                            <CheckCircle2 size={13} /> ✓ Abhaken
                                        </button>
                                    </div>
                                </div>
                            );
                        })
                    )}
                </div>

                {/* 4. Footer */}
                <div style={{
                    padding: '12px 24px',
                    borderTop: '1px solid #e2e8f0',
                    backgroundColor: '#ffffff',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '12px'
                }}>
                    <span style={{ fontSize: '12px', color: '#64748b' }}>
                        Tipp: Du kannst jederzeit ein alternatives Bild anklicken oder Daten manuell bearbeiten.
                    </span>

                    <button
                        type="button"
                        onClick={onClose}
                        className="btn btn-ghost"
                        style={{ border: '1px solid #cbd5e1' }}
                    >
                        Fertig
                    </button>
                </div>
            </div>
        </div>
    );
};
