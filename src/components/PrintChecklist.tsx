import React from 'react';
import type { Order } from '../types';

const cleanNotes = (notes?: string) => {
    if (!notes) return '-';
    const cleaned = notes.split('KI-Import')[0].trim();
    return cleaned || '-';
};

interface PrintChecklistProps {
    supplierName: string;
    orders: Order[];
}

export const PrintChecklist: React.FC<PrintChecklistProps> = ({ supplierName, orders }) => {
    return (
        <div className="print-checklist-container" style={{
            fontFamily: 'sans-serif',
            color: 'black',
            backgroundColor: 'white',
            padding: '2cm',
            width: '100%',
            maxWidth: '100%',
            boxSizing: 'border-box'
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '2px solid black', paddingBottom: '16px', marginBottom: '24px' }}>
                <h1 style={{ margin: 0, fontSize: '24px' }}>Warenannahme: {supplierName}</h1>
                <div style={{ fontSize: '14px', color: '#333' }}>
                    Datum: {new Date().toLocaleDateString('de-DE')}
                </div>
            </div>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '24px' }}>
                <thead>
                    <tr>
                        <th style={{ borderBottom: '1px solid black', textAlign: 'left', padding: '8px 12px', fontSize: '14px' }}>Artikel</th>
                        <th style={{ borderBottom: '1px solid black', textAlign: 'center', padding: '8px 12px', fontSize: '14px', width: '100px' }}>Menge</th>
                        <th style={{ borderBottom: '1px solid black', textAlign: 'center', padding: '8px 12px', fontSize: '14px', width: '100px' }}>Notizen</th>
                        <th style={{ borderBottom: '1px solid black', textAlign: 'center', padding: '8px 12px', fontSize: '14px', width: '80px' }}>Erhalten</th>
                    </tr>
                </thead>
                <tbody>
                    {orders.map(order => (
                        <tr key={order.id} style={{ borderBottom: '1px solid #ddd' }}>
                            <td style={{ padding: '16px 12px', verticalAlign: 'middle', fontSize: '16px', fontWeight: 500 }}>
                                {order.productName}
                                {order.orderNumber && (
                                    <div style={{ fontSize: '12px', color: '#666', marginTop: '4px', fontWeight: 'normal' }}>
                                        Bestellnr: {order.orderNumber}
                                    </div>
                                )}
                            </td>
                            <td style={{ padding: '16px 12px', verticalAlign: 'middle', textAlign: 'center', fontSize: '16px', fontWeight: 600 }}>
                                {order.quantity}
                            </td>
                            <td style={{ padding: '16px 12px', verticalAlign: 'middle', textAlign: 'center', fontSize: '14px', fontStyle: 'italic', color: '#555' }}>
                                {cleanNotes(order.notes)}
                            </td>
                            <td style={{ padding: '16px 12px', verticalAlign: 'middle', textAlign: 'center' }}>
                                <div style={{ 
                                    width: '24px', 
                                    height: '24px', 
                                    border: '2px solid black', 
                                    borderRadius: '4px',
                                    margin: '0 auto' 
                                }}></div>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            
            <div style={{ marginTop: '64px', display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ width: '300px', borderTop: '1px solid black', textAlign: 'center', paddingTop: '8px', fontSize: '14px', color: '#333' }}>
                    Unterschrift Prüfer
                </div>
            </div>
        </div>
    );
};
