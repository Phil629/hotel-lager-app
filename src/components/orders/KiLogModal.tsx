import React, { useState } from 'react';
import { Bot, X, AlertTriangle, RefreshCw } from 'lucide-react';
import { supabase } from '../../services/supabase';

export interface InboundEmail {
    id: string;
    supplier_name: string;
    subject: string;
    body_text: string;
    extracted_data: {
        document_type?: string;
        confidence?: number;
        supplier_name?: string;
        items?: { product_name: string; quantity: number; price?: number }[];
        total_price?: number;
        order_date?: string;
        invoice_number?: string;
        parse_error?: string;
        raw_text?: string;
    } | null;
    status: string;
    created_at: string;
}

export const timeAgo = (dateStr: string): string => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 2) return 'gerade eben';
    if (mins < 60) return `vor ${mins} Min.`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `vor ${hours} Std.`;
    const days = Math.floor(hours / 24);
    return `vor ${days} Tag${days !== 1 ? 'en' : ''}`;
};

export const KiStatusBadge: React.FC<{ status: string }> = ({ status }) => {
    if (status === 'processed') return <span className="badge badge-success">Erfolgreich</span>;
    if (status === 'gemini_error') return <span className="badge badge-danger">KI-Fehler</span>;
    if (status === 'processed_duplicate') return <span className="badge badge-success" title="Bestellung existierte bereits und wurde verknüpft">Aktualisiert</span>;
    return <span className="badge badge-neutral">{status}</span>;
};

interface KiLogDetailProps {
    email: InboundEmail;
    onReprocess?: (email: InboundEmail) => void;
    reprocessingId?: string | null;
}

export const KiLogDetail: React.FC<KiLogDetailProps> = ({ email, onReprocess, reprocessingId }) => {
    const d = email.extracted_data;
    const fmtPrice = (v: number) => v.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    const isBusy = reprocessingId === email.id;

    const reprocessButton = onReprocess && email.body_text ? (
        <button
            type="button"
            className={email.status === 'gemini_error' ? 'btn btn-sm btn-primary' : 'btn btn-sm btn-ghost'}
            disabled={!!reprocessingId}
            onClick={(e) => {
                e.stopPropagation();
                onReprocess(email);
            }}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', alignSelf: 'flex-start' }}
        >
            <RefreshCw size={13} style={isBusy ? { animation: 'agy-spin 1s linear infinite' } : undefined} />
            {isBusy ? 'KI verarbeitet E-Mail…' : 'Mit KI erneut verarbeiten'}
        </button>
    ) : null;

    if (!d || email.status === 'gemini_error') {
        return (
            <div style={{ color: 'var(--color-danger)', fontSize: '13px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                        <AlertTriangle size={14} />
                        KI konnte die E-Mail nicht verarbeiten – kein JSON extrahiert.
                    </div>
                    {reprocessButton}
                </div>
                {d?.parse_error && (
                    <div style={{ padding: '8px', backgroundColor: 'var(--color-danger-bg)', borderRadius: '4px', border: '1px solid #fca5a5', fontFamily: 'monospace', fontSize: '11px', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
                        <strong>Error:</strong> {d.parse_error}<br/>
                        <strong>Raw Text:</strong><br/>{d.raw_text}
                    </div>
                )}
            </div>
        );
    }
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 24px', fontSize: '13px' }}>
                    {d.document_type && <span><span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Typ:</span> {d.document_type}</span>}
                    {d.supplier_name && <span><span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Lieferant:</span> {d.supplier_name}</span>}
                    {d.order_date && <span><span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Datum:</span> {d.order_date}</span>}
                    {d.invoice_number && <span><span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Belegnr.:</span> {d.invoice_number}</span>}
                    {d.total_price != null && <span><span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Gesamt:</span> {fmtPrice(d.total_price)}</span>}
                    {d.confidence != null && (
                        <span>
                            <span style={{ color: 'var(--color-text-muted)', fontWeight: 600 }}>Konfidenz:</span>{' '}
                            <span style={{ color: d.confidence >= 0.8 ? 'var(--color-success)' : d.confidence >= 0.5 ? 'var(--color-warning)' : 'var(--color-danger)', fontWeight: 600 }}>
                                {(d.confidence * 100).toFixed(0)}%
                            </span>
                        </span>
                    )}
                </div>
                {reprocessButton}
            </div>
            {email.status === 'processed_duplicate' && (
                <div style={{ fontSize: '12px', color: '#15803d', padding: '8px 12px', backgroundColor: '#f0fdf4', borderRadius: 'var(--radius-sm)', border: '1px solid #bbf7d0' }}>
                    🔗 <strong>Mit bestehender Bestellung verknüpft:</strong> Diese Bestellung (bzw. Bestellnummer) existierte bereits im System (z. B. schon unter „Erhalten“ verbucht oder aus einer vorherigen E-Mail angelegt) und wurde deshalb aktualisiert statt doppelt neu angelegt.
                </div>
            )}
            {d.items?.length ? (
                <div>
                    <div style={{ fontSize: '12px', fontWeight: 700, color: 'var(--color-text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '6px' }}>
                        {d.items.length} Positionen erkannt
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                        {d.items.slice(0, 12).map((item, i) => (
                            <span key={i} style={{ backgroundColor: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', padding: '3px 10px', fontSize: '12px', color: 'var(--color-text-secondary)' }}>
                                {item.quantity}× {item.product_name}{item.price ? ` · ${fmtPrice(item.price)}` : ''}
                            </span>
                        ))}
                        {d.items.length > 12 && (
                            <span style={{ fontSize: '12px', color: 'var(--color-text-faint)', padding: '3px 4px' }}>
                                +{d.items.length - 12} weitere
                            </span>
                        )}
                    </div>
                </div>
            ) : ((d as any).tracking_link || (d as any).delivery_date || (d as any).order_notes) ? (
                <div style={{ fontSize: '13px', color: 'var(--color-success)', marginTop: '8px', padding: '12px', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                    ✅ <strong>Versand-Informationen verarbeitet:</strong> Die Tracking- und Lieferdaten aus dieser E-Mail wurden erfolgreich zu deinen Bestellungen hinzugefügt.
                </div>
            ) : (
                <div style={{ fontSize: '13px', color: 'var(--color-text-muted)', marginTop: '8px', padding: '12px', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}>
                    ℹ️ <strong>Keine Bestell-Daten erkannt:</strong> Diese E-Mail enthielt keine relevanten Positionen (vermutlich Newsletter oder Werbung). Es wurden <u>keine</u> Bestellungen angelegt.
                </div>
            )}
        </div>
    );
};

interface KiLogModalProps {
    isOpen: boolean;
    onClose: () => void;
    inboundEmails: InboundEmail[];
    onReprocessed?: () => void;
}

export const KiLogModal: React.FC<KiLogModalProps> = ({ isOpen, onClose, inboundEmails, onReprocessed }) => {
    const [selectedKiLog, setSelectedKiLog] = useState<InboundEmail | null>(null);
    const [reprocessingId, setReprocessingId] = useState<string | null>(null);
    const [statusMsg, setStatusMsg] = useState<{ text: string; isError?: boolean } | null>(null);

    if (!isOpen) return null;

    const handleReprocess = async (email: InboundEmail) => {
        if (!supabase || reprocessingId) return;
        setReprocessingId(email.id);
        setStatusMsg(null);
        try {
            const { data, error } = await supabase.functions.invoke('process-inbound-mail', {
                body: {
                    action: 'reprocess',
                    inbound_email_id: email.id
                }
            });
            if (error) throw error;
            if (data?.error) throw new Error(data.error);

            if (data?.success) {
                const newCount = Array.isArray(data?.createdOrders) ? data.createdOrders.length : 0;
                if (data.status === 'processed_duplicate') {
                    setStatusMsg({
                        text: '✅ E-Mail erfolgreich verarbeitet! Die zugehörige Bestellung existierte bereits (z. B. schon als „Erhalten" verbucht) und wurde verknüpft statt doppelt angelegt.'
                    });
                } else if (newCount > 0) {
                    setStatusMsg({
                        text: `✅ E-Mail erfolgreich verarbeitet! ${newCount} neue Bestellung(en) angelegt.`
                    });
                } else {
                    setStatusMsg({ text: '✅ E-Mail wurde erfolgreich mit der KI neu verarbeitet!' });
                }
                if (data.extracted_data) {
                    setSelectedKiLog({
                        ...email,
                        status: data.status || 'processed',
                        extracted_data: data.extracted_data
                    });
                }
                onReprocessed?.();
            } else {
                setStatusMsg({ text: data?.message || 'KI konnte die E-Mail nicht verarbeiten.', isError: true });
                onReprocessed?.();
            }
        } catch (err: any) {
            console.error('Error reprocessing email:', err);
            setStatusMsg({ text: 'Fehler beim erneuten Verarbeiten: ' + (err?.message || String(err)), isError: true });
        } finally {
            setReprocessingId(null);
        }
    };

    return (
        <div className="modal-overlay" onClick={() => { onClose(); setSelectedKiLog(null); setStatusMsg(null); }}>
            <style>{`
                @keyframes agy-spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
            `}</style>
            <div
                className="modal-box"
                style={{ maxWidth: '760px', maxHeight: '82vh', display: 'flex', flexDirection: 'column' }}
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="modal-header">
                    <Bot size={18} color="var(--color-primary)" />
                    <h3 style={{ flex: 1 }}>KI-Import Protokoll</h3>
                    <button
                        className="btn btn-ghost btn-sm"
                        style={{ padding: '4px 8px' }}
                        onClick={() => { onClose(); setSelectedKiLog(null); setStatusMsg(null); }}
                    >
                        <X size={16} />
                    </button>
                </div>

                {statusMsg && (
                    <div style={{
                        padding: '10px 20px',
                        fontSize: '13px',
                        fontWeight: 500,
                        backgroundColor: statusMsg.isError ? 'var(--color-danger-bg)' : '#f0fdf4',
                        color: statusMsg.isError ? 'var(--color-danger)' : '#15803d',
                        borderBottom: '1px solid var(--color-border)'
                    }}>
                        {statusMsg.text}
                    </div>
                )}

                {/* Body */}
                <div style={{ flex: 1, overflowY: 'auto' }}>
                    {inboundEmails.length === 0 ? (
                        <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--color-text-muted)' }}>
                            <Bot size={36} style={{ opacity: 0.2, display: 'block', margin: '0 auto 12px' }} />
                            Noch keine KI-Importe vorhanden.
                        </div>
                    ) : (
                        <table className="products-table">
                            <thead>
                                <tr>
                                    <th style={{ width: '125px' }}>Datum</th>
                                    <th style={{ width: '150px' }}>Absender</th>
                                    <th>Betreff</th>
                                    <th style={{ width: '195px', textAlign: 'center' }}>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                                {inboundEmails.map(email => {
                                    const isSelected = selectedKiLog?.id === email.id;
                                    const currentEmail = isSelected && selectedKiLog ? selectedKiLog : email;
                                    const isRowBusy = reprocessingId === email.id;
                                    return (
                                        <React.Fragment key={email.id}>
                                            <tr
                                                onClick={() => setSelectedKiLog(isSelected ? null : email)}
                                                style={{ cursor: 'pointer', backgroundColor: isSelected ? 'var(--color-surface-elevated)' : undefined }}
                                            >
                                                <td style={{ fontSize: '12px', color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                                                    {new Date(email.created_at).toLocaleString('de-DE', {
                                                        day: '2-digit', month: '2-digit', year: '2-digit',
                                                        hour: '2-digit', minute: '2-digit',
                                                    })}
                                                </td>
                                                <td style={{ fontSize: '13px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {email.supplier_name || '–'}
                                                </td>
                                                <td style={{ fontSize: '13px', color: 'var(--color-text-main)', maxWidth: '240px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {email.subject || <span style={{ color: 'var(--color-text-faint)' }}>(kein Betreff)</span>}
                                                </td>
                                                <td style={{ textAlign: 'center', whiteSpace: 'nowrap' }}>
                                                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                                                        <KiStatusBadge status={currentEmail.status} />
                                                        {currentEmail.status === 'gemini_error' && email.body_text && (
                                                            <button
                                                                type="button"
                                                                className="btn btn-sm btn-primary"
                                                                disabled={!!reprocessingId}
                                                                title="Diese fehlgeschlagene E-Mail direkt mit der KI neu prüfen"
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    handleReprocess(email);
                                                                }}
                                                                style={{
                                                                    padding: '2px 8px',
                                                                    fontSize: '11px',
                                                                    height: '24px',
                                                                    display: 'inline-flex',
                                                                    alignItems: 'center',
                                                                    gap: '4px'
                                                                }}
                                                            >
                                                                <RefreshCw
                                                                    size={11}
                                                                    style={isRowBusy ? { animation: 'agy-spin 1s linear infinite' } : undefined}
                                                                />
                                                                {isRowBusy ? 'Prüft…' : 'KI prüfen'}
                                                            </button>
                                                        )}
                                                    </div>
                                                </td>
                                            </tr>
                                            {isSelected && (
                                                <tr>
                                                    <td colSpan={4} style={{ padding: '14px 20px 16px', backgroundColor: 'var(--color-surface-elevated)', borderBottom: '1px solid var(--color-border)' }}>
                                                        <KiLogDetail
                                                            email={currentEmail}
                                                            onReprocess={handleReprocess}
                                                            reprocessingId={reprocessingId}
                                                        />
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    )}
                </div>

                {/* Footer */}
                <div className="modal-footer">
                    <span style={{ fontSize: '12px', color: 'var(--color-text-faint)', marginRight: 'auto' }}>
                        {inboundEmails.length} Einträge · Klick auf Zeile für Details
                    </span>
                    <button className="btn btn-ghost" onClick={() => { onClose(); setSelectedKiLog(null); setStatusMsg(null); }}>
                        Schließen
                    </button>
                </div>
            </div>
        </div>
    );
};
