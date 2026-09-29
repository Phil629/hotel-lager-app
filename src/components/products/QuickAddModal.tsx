import React from 'react';
import { Plus, X } from 'lucide-react';
import type { Supplier } from '../../types';

interface QuickAddModalProps {
    isOpen: boolean;
    supplierId: string | null;
    suppliers: Supplier[];
    text: string;
    setText: (text: string) => void;
    isLoading: boolean;
    onClose: () => void;
    onSubmit: () => Promise<void>;
}

export const QuickAddModal: React.FC<QuickAddModalProps> = ({
    isOpen,
    supplierId,
    text,
    setText,
    isLoading,
    onClose,
    onSubmit,
}) => {
    if (!isOpen || !supplierId) return null;

    const lineCount = text.split('\n').map(l => l.trim()).filter(l => l.length > 0).length;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '500px' }}>
                <div className="modal-header" style={{ padding: '24px 24px 16px 24px', borderBottom: '1px solid var(--color-border)' }}>
                    <h2 style={{ margin: 0, fontSize: '20px', fontWeight: 700, color: 'var(--color-text-main)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Plus size={22} color="var(--color-primary)" />
                        Mehrere Produkte anlegen
                    </h2>
                    <button onClick={onClose} className="btn btn-ghost btn-icon" style={{ padding: '8px' }}>
                        <X size={20} />
                    </button>
                </div>
                <div className="modal-body" style={{ padding: '24px', backgroundColor: '#f8fafc' }}>
                    <div style={{ backgroundColor: '#eff6ff', color: '#1d4ed8', padding: '16px', borderRadius: 'var(--radius-lg)', marginBottom: '24px', fontSize: '14px', border: '1px solid #bfdbfe', display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                        <div style={{ marginTop: '2px' }}><Plus size={18} /></div>
                        <div>
                            <strong style={{ display: 'block', marginBottom: '4px' }}>Tipp für schnelles Anlegen:</strong> 
                            Kopiere einfach die Produkte aus einer Rechnung, PDF oder E-Mail und füge sie hier ein (genau ein Produkt pro Zeile).
                        </div>
                    </div>
                    <div className="form-group" style={{ margin: 0 }}>
                        <label className="form-label" style={{ fontWeight: 600, color: 'var(--color-text-main)', marginBottom: '8px' }}>Produktnamen eingeben:</label>
                        <textarea
                            value={text}
                            onChange={(e) => setText(e.target.value)}
                            placeholder="Cola 0.5L&#10;Fanta 0.5L&#10;Sprite 0.5L"
                            rows={8}
                            className="input-field"
                            style={{ fontFamily: 'inherit', padding: '16px', fontSize: '15px', lineHeight: '1.6', borderRadius: 'var(--radius-lg)', backgroundColor: 'var(--color-surface)', border: '1px solid #cbd5e1', boxShadow: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.02)', resize: 'vertical' }}
                            autoFocus
                        />
                    </div>
                </div>
                <div className="modal-footer" style={{ padding: '16px 24px', borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)' }}>
                    <button onClick={onClose} className="btn btn-ghost" disabled={isLoading}>Abbrechen</button>
                    <button 
                        onClick={onSubmit}
                        className="btn btn-primary"
                        disabled={isLoading || text.trim().length === 0}
                    >
                        {isLoading ? 'Speichert...' : `${lineCount} Produkte anlegen`}
                    </button>
                </div>
            </div>
        </div>
    );
};
