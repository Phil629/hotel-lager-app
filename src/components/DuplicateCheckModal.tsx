import React, { useState, useEffect } from 'react';
import { Sparkles, X, CheckSquare, Square, ArrowLeftRight, RefreshCw, AlertTriangle, CheckCircle2 } from 'lucide-react';
import { supabase } from '../services/supabase';

export interface DuplicateSuggestion {
    id: string;
    type: 'supplier' | 'product';
    keepId: string;
    keepName: string;
    keepMeta?: string;
    mergeId: string;
    mergeName: string;
    mergeMeta?: string;
    reason: string;
}

interface DuplicateCheckModalProps {
    isOpen: boolean;
    onClose: () => void;
    onMerged: (summaryMsg: string) => void;
}

export const DuplicateCheckModal: React.FC<DuplicateCheckModalProps> = ({ isOpen, onClose, onMerged }) => {
    const [loading, setLoading] = useState(false);
    const [merging, setMerging] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [duplicates, setDuplicates] = useState<DuplicateSuggestion[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [elapsedMs, setElapsedMs] = useState(0);
    const [catalogCounts, setCatalogCounts] = useState<{ suppliers: number; products: number } | null>(null);

    useEffect(() => {
        if (!loading) {
            setElapsedMs(0);
            return;
        }
        const start = Date.now();
        const interval = setInterval(() => {
            setElapsedMs(Date.now() - start);
        }, 200);
        return () => clearInterval(interval);
    }, [loading]);

    const runCheck = async () => {
        if (!supabase) return;
        setLoading(true);
        setError(null);

        // Fetch live counts in parallel so the loading animation shows exact catalog numbers
        supabase
            .from('suppliers')
            .select('id', { count: 'exact', head: true })
            .then(({ count: supCount }) => {
                supabase!
                    .from('products')
                    .select('id', { count: 'exact', head: true })
                    .then(({ count: prodCount }) => {
                        setCatalogCounts({
                            suppliers: supCount ?? 0,
                            products: prodCount ?? 0
                        });
                    });
            });

        try {
            const { data, error: fnErr } = await supabase.functions.invoke('process-inbound-mail', {
                body: { action: 'find_duplicates' }
            });
            if (fnErr) throw fnErr;
            if (data?.error) throw new Error(data.error);

            const list: DuplicateSuggestion[] = Array.isArray(data?.duplicates) ? data.duplicates : [];
            setDuplicates(list);
            setSelectedIds(new Set(list.map(d => d.id)));
        } catch (err: any) {
            console.error('Duplicate check error:', err);
            setError(err?.message || 'Fehler bei der KI-Duplikatprüfung.');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (isOpen) {
            runCheck();
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const allSelected = duplicates.length > 0 && selectedIds.size === duplicates.length;

    const toggleAll = () => {
        if (allSelected) {
            setSelectedIds(new Set());
        } else {
            setSelectedIds(new Set(duplicates.map(d => d.id)));
        }
    };

    const toggleOne = (id: string) => {
        const next = new Set(selectedIds);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        setSelectedIds(next);
    };

    const swapDirection = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        setDuplicates(prev => prev.map(d => {
            if (d.id !== id) return d;
            return {
                ...d,
                keepId: d.mergeId,
                keepName: d.mergeName,
                keepMeta: d.mergeMeta,
                mergeId: d.keepId,
                mergeName: d.keepName,
                mergeMeta: d.keepMeta,
            };
        }));
    };

    const handleMergeSelected = async () => {
        if (!supabase || selectedIds.size === 0) return;
        setMerging(true);
        setError(null);
        try {
            const toMerge = duplicates
                .filter(d => selectedIds.has(d.id))
                .map(d => ({
                    type: d.type,
                    keepId: d.keepId,
                    mergeId: d.mergeId
                }));

            const { data, error: fnErr } = await supabase.functions.invoke('process-inbound-mail', {
                body: {
                    action: 'execute_merge',
                    merges: toMerge
                }
            });
            if (fnErr) throw fnErr;
            if (data?.error) throw new Error(data.error);

            const supCount = data?.mergedSuppliers || 0;
            const prodCount = data?.mergedProducts || 0;
            onMerged(`Duplikate bereinigt: ${prodCount} Produkt(e) und ${supCount} Lieferant(en) zusammengeführt.`);
            onClose();
        } catch (err: any) {
            console.error('Merge execution error:', err);
            setError(err?.message || 'Fehler beim Zusammenführen der Duplikate.');
        } finally {
            setMerging(false);
        }
    };

    const loadingSteps = [
        {
            label: catalogCounts
                ? `Lade Katalog (${catalogCounts.products} Produkte & ${catalogCounts.suppliers} Lieferanten)…`
                : 'Lade Produkt- und Lieferantenkatalog aus der Datenbank…',
            doneAfterMs: 900
        },
        {
            label: 'Vorfilterung: Suche nach ähnlichen Artikelnamen, Marken & E-Mail-Domains…',
            doneAfterMs: 2200
        },
        {
            label: 'KI-Abgleich: Prüfe Kandidaten auf echte Duplikate (ignoriert Varianten wie Zero/Light)…',
            doneAfterMs: 999999
        }
    ];

    return (
        <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
            <style>{`
                @keyframes agy-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                @keyframes agy-progress-indeterminate {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(250%); }
                }
            `}</style>
            <div
                className="modal-box"
                style={{ maxWidth: '780px', width: '95%', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="modal-header" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <Sparkles size={18} color="var(--color-primary)" />
                    <h3 style={{ flex: 1, margin: 0 }}>KI-Prüfung: Doppelte Produkte & Lieferanten</h3>
                    <button
                        className="btn btn-ghost btn-sm"
                        onClick={runCheck}
                        disabled={loading || merging}
                        title="Erneut prüfen"
                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                    >
                        <RefreshCw
                            size={14}
                            style={loading ? { animation: 'agy-spin 1s linear infinite' } : undefined}
                        />
                        Neu prüfen
                    </button>
                    <button className="btn btn-ghost btn-sm" style={{ padding: '4px 8px' }} onClick={onClose}>
                        <X size={16} />
                    </button>
                </div>

                {/* Toolbar: Alles abhaken */}
                {!loading && duplicates.length > 0 && (
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
                        <button
                            type="button"
                            onClick={toggleAll}
                            className="btn btn-sm btn-ghost"
                            style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 600 }}
                        >
                            {allSelected ? <CheckSquare size={16} color="var(--color-primary)" /> : <Square size={16} />}
                            {allSelected ? 'Alle abwählen' : 'Alle abhaken'}
                        </button>
                        <span style={{ fontSize: '13px', color: 'var(--color-text-muted)' }}>
                            <strong>{selectedIds.size}</strong> von <strong>{duplicates.length}</strong> Vorschlägen ausgewählt · Bestellungen & Bestände werden automatisch übernommen
                        </span>
                    </div>
                )}

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                    {error && (
                        <div style={{
                            padding: '14px 16px',
                            marginBottom: '12px',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: 'var(--color-danger-bg)',
                            color: 'var(--color-danger)',
                            border: '1px solid #fca5a5',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: '12px',
                            fontSize: '13px',
                            flexWrap: 'wrap'
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <AlertTriangle size={16} style={{ flexShrink: 0 }} />
                                <span>{error}</span>
                            </div>
                            <button
                                type="button"
                                className="btn btn-sm btn-primary"
                                onClick={runCheck}
                                disabled={loading}
                                style={{ display: 'inline-flex', alignItems: 'center', gap: '6px' }}
                            >
                                <RefreshCw size={13} />
                                Erneut versuchen
                            </button>
                        </div>
                    )}

                    {loading ? (
                        <div style={{ padding: '32px 20px', maxWidth: '520px', margin: '0 auto' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
                                <div style={{
                                    width: '42px',
                                    height: '42px',
                                    borderRadius: '50%',
                                    backgroundColor: 'rgba(37, 99, 235, 0.1)',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0
                                }}>
                                    <RefreshCw
                                        size={22}
                                        style={{ color: 'var(--color-primary)', animation: 'agy-spin 1s linear infinite' }}
                                    />
                                </div>
                                <div style={{ flex: 1 }}>
                                    <div style={{ fontWeight: 600, color: 'var(--color-text-main)', fontSize: '15px' }}>
                                        KI-Duplikatprüfung läuft… ({(elapsedMs / 1000).toFixed(1)}s)
                                    </div>
                                    <div style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                        Analysiere Schreibweisen, Packungsgrößen und Lieferanten-Einträge
                                    </div>
                                </div>
                            </div>

                            {/* Animated Progress Bar */}
                            <div style={{
                                height: '6px',
                                width: '100%',
                                backgroundColor: 'var(--color-surface-elevated)',
                                borderRadius: '999px',
                                overflow: 'hidden',
                                marginBottom: '18px',
                                border: '1px solid var(--color-border)'
                            }}>
                                <div style={{
                                    width: '45%',
                                    height: '100%',
                                    backgroundColor: 'var(--color-primary)',
                                    borderRadius: '999px',
                                    animation: 'agy-progress-indeterminate 1.4s ease-in-out infinite'
                                }} />
                            </div>

                            {/* Live Step Checklist */}
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '10px',
                                backgroundColor: 'var(--color-surface-elevated)',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                padding: '14px 16px'
                            }}>
                                {loadingSteps.map((step, idx) => {
                                    const isDone = elapsedMs >= step.doneAfterMs;
                                    const prevDone = idx === 0 || elapsedMs >= loadingSteps[idx - 1].doneAfterMs;
                                    const isCurrent = !isDone && prevDone;
                                    return (
                                        <div
                                            key={idx}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '10px',
                                                fontSize: '13px',
                                                color: isDone
                                                    ? 'var(--color-success)'
                                                    : isCurrent
                                                        ? 'var(--color-text-main)'
                                                        : 'var(--color-text-muted)',
                                                fontWeight: isCurrent ? 600 : 400,
                                                opacity: isDone || isCurrent ? 1 : 0.55
                                            }}
                                        >
                                            {isDone ? (
                                                <CheckCircle2 size={16} style={{ color: 'var(--color-success)', flexShrink: 0 }} />
                                            ) : isCurrent ? (
                                                <RefreshCw
                                                    size={15}
                                                    style={{
                                                        color: 'var(--color-primary)',
                                                        flexShrink: 0,
                                                        animation: 'agy-spin 1s linear infinite'
                                                    }}
                                                />
                                            ) : (
                                                <div style={{
                                                    width: '15px',
                                                    height: '15px',
                                                    borderRadius: '50%',
                                                    border: '1.5px solid var(--color-border)',
                                                    flexShrink: 0
                                                }} />
                                            )}
                                            <span>{step.label}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ) : !error && duplicates.length === 0 ? (
                        <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                            <CheckCircle2 size={36} style={{ color: 'var(--color-success)', display: 'block', margin: '0 auto 12px' }} />
                            <div style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '4px' }}>
                                Keine Duplikate gefunden!
                            </div>
                            <div style={{ fontSize: '13px' }}>
                                Alle Produkte und Lieferanten sind aktuell eindeutig.
                            </div>
                        </div>
                    ) : duplicates.length > 0 ? (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            {duplicates.map(item => {
                                const isChecked = selectedIds.has(item.id);
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => toggleOne(item.id)}
                                        style={{
                                            border: isChecked ? '1.5px solid var(--color-primary)' : '1px solid var(--color-border)',
                                            backgroundColor: isChecked ? 'rgba(37, 99, 235, 0.04)' : 'var(--color-surface)',
                                            borderRadius: 'var(--radius-md)',
                                            padding: '12px 14px',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'flex-start',
                                            gap: '12px',
                                            transition: 'all 0.15s ease'
                                        }}
                                    >
                                        <div style={{ paddingTop: '2px' }}>
                                            {isChecked ? (
                                                <CheckSquare size={18} color="var(--color-primary)" />
                                            ) : (
                                                <Square size={18} color="var(--color-text-muted)" />
                                            )}
                                        </div>

                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px', flexWrap: 'wrap' }}>
                                                <span style={{
                                                    fontSize: '11px',
                                                    fontWeight: 700,
                                                    textTransform: 'uppercase',
                                                    padding: '2px 8px',
                                                    borderRadius: '999px',
                                                    backgroundColor: item.type === 'supplier' ? '#e0e7ff' : '#fef3c7',
                                                    color: item.type === 'supplier' ? '#3730a3' : '#92400e'
                                                }}>
                                                    {item.type === 'supplier' ? 'Lieferant' : 'Produkt'}
                                                </span>
                                                <span style={{ fontSize: '12px', color: 'var(--color-text-muted)' }}>
                                                    {item.reason}
                                                </span>
                                            </div>

                                            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: '8px', alignItems: 'center' }}>
                                                {/* Keep Box */}
                                                <div style={{
                                                    padding: '8px 10px',
                                                    borderRadius: 'var(--radius-sm)',
                                                    backgroundColor: '#f0fdf4',
                                                    border: '1px solid #bbf7d0',
                                                    minWidth: 0
                                                }}>
                                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#15803d', textTransform: 'uppercase', marginBottom: '2px' }}>
                                                        ✓ Bleibt erhalten
                                                    </div>
                                                    <div style={{ fontSize: '13px', fontWeight: 600, color: '#14532d', wordBreak: 'break-word' }}>
                                                        {item.keepName}
                                                    </div>
                                                    {item.keepMeta && (
                                                        <div style={{ fontSize: '11px', color: '#166534', marginTop: '2px' }}>
                                                            {item.keepMeta}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Swap Button */}
                                                <button
                                                    type="button"
                                                    onClick={(e) => swapDirection(item.id, e)}
                                                    title="Richtung tauschen (anderen Namen behalten)"
                                                    className="btn btn-ghost btn-sm"
                                                    style={{ padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                                                >
                                                    <ArrowLeftRight size={14} />
                                                </button>

                                                {/* Merge Box */}
                                                <div style={{
                                                    padding: '8px 10px',
                                                    borderRadius: 'var(--radius-sm)',
                                                    backgroundColor: '#fef2f2',
                                                    border: '1px solid #fecaca',
                                                    minWidth: 0
                                                }}>
                                                    <div style={{ fontSize: '10px', fontWeight: 700, color: '#b91c1c', textTransform: 'uppercase', marginBottom: '2px' }}>
                                                        → Wird zusammengeführt
                                                    </div>
                                                    <div style={{ fontSize: '13px', fontWeight: 500, color: '#7f1d1d', textDecoration: 'line-through', wordBreak: 'break-word' }}>
                                                        {item.mergeName}
                                                    </div>
                                                    {item.mergeMeta && (
                                                        <div style={{ fontSize: '11px', color: '#991b1b', marginTop: '2px' }}>
                                                            {item.mergeMeta}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : null}
                </div>

                {/* Footer */}
                <div className="modal-footer" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                    <button className="btn btn-ghost" onClick={onClose} disabled={merging}>
                        Abbrechen
                    </button>
                    {duplicates.length > 0 && (
                        <button
                            className="btn btn-primary"
                            onClick={handleMergeSelected}
                            disabled={merging || loading || selectedIds.size === 0}
                            style={{ display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                            <Sparkles size={15} />
                            {merging ? 'Wird zusammengeführt…' : `Ausgewählte zusammenführen (${selectedIds.size})`}
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
};
