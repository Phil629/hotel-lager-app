import React, { useState, useEffect } from 'react';
import { DataService } from '../../services/data';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

interface PriceHistoryChartProps {
    productName: string;
}

export const PriceHistoryChart: React.FC<PriceHistoryChartProps> = ({ productName }) => {
    const [data, setData] = useState<any[]>([]);

    useEffect(() => {
        if (!productName) return;
        Promise.all([DataService.getOrders(), DataService.getProducts()]).then(([orders, products]) => {
            const prod = products.find(p => p.name === productName);
            const fallbackPrice = prod?.price ?? 0;
            const filtered = orders
                .filter(o => o.productName === productName && ((o.price ?? fallbackPrice) > 0))
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
                .map(o => ({
                    date: new Date(o.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric'}),
                    price: o.price ?? fallbackPrice,
                    supplier: o.supplierName || 'Unbekannt'
                }));
            setData(filtered);
        });
    }, [productName]);

    if (data.length === 0) {
        return (
            <div style={{ padding: '30px 10px', textAlign: 'center', color: '#94a3b8', backgroundColor: '#f8fafc', borderRadius: '8px' }}>
                Keine historischen Preisdaten für dieses Produkt gefunden.
            </div>
        );
    }

    if (data.length === 1) {
        return (
            <div style={{ padding: '24px 16px', textAlign: 'center', backgroundColor: '#f8fafc', borderRadius: '8px', border: '1px dashed #e2e8f0', marginTop: '16px' }}>
                <div style={{ fontSize: '20px', fontWeight: 700, color: '#0284c7', marginBottom: '6px' }}>
                    {Number(data[0].price).toFixed(2)} €
                </div>
                <div style={{ fontSize: '13px', color: '#475569', marginBottom: '4px' }}>
                    1 Bestellung am {data[0].date} (Lieferant: {data[0].supplier})
                </div>
                <div style={{ fontSize: '11px', color: '#94a3b8' }}>
                    Ein Verlaufschart wird ab der 2. Bestellung gezeichnet.
                </div>
            </div>
        );
    }

    return (
        <div style={{ width: '100%', height: 280, marginTop: '20px' }}>
            <ResponsiveContainer width="100%" height="100%">
                <LineChart data={data} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="date" tick={{fontSize: 12, fill: '#64748b'}} tickMargin={10} axisLine={false} tickLine={false} />
                    <YAxis
                        dataKey="price"
                        tick={{fontSize: 12, fill: '#64748b'}}
                        tickFormatter={val => Number(val).toFixed(2) + '€'}
                        axisLine={false}
                        tickLine={false}
                        domain={[dataMin => +(Math.max(0, dataMin * 0.85)).toFixed(2), dataMax => +(dataMax * 1.15).toFixed(2)]}
                    />
                    <Tooltip 
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                        formatter={(value: any, _name: any, props: any) => [`${Number(value).toFixed(2)} € (Lieferant: ${props.payload.supplier})`, 'Einkaufspreis']}
                        labelFormatter={(label: any) => `Kaufdatum: ${label}`}
                    />
                    <Line type="stepAfter" dataKey="price" stroke="#0ea5e9" strokeWidth={3} dot={{r: 4, fill: '#0284c7', strokeWidth: 0}} activeDot={{r: 6}} animationDuration={1500} />
                </LineChart>
            </ResponsiveContainer>
        </div>
    );
};
