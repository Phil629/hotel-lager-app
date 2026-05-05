const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

// Defect Modal UI Fix
const defectUIRegex = /<p style=\{\{ fontSize: 'var\(--font-size-sm\)', color: 'var\(--color-text-muted\)', marginBottom: 'var\(--spacing-md\)' \}\}>\s*Produkt: <strong>\{defectModalOrder\.productName\}<\/strong>\s*<\/p>/;

const newDefectModalUI = `{defectModalOrderOptions && defectModalOrderOptions.length > 1 ? (
                                <div style={{ marginBottom: 'var(--spacing-md)' }}>
                                    <label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 500 }}>
                                        Produkt auswählen
                                    </label>
                                    <select
                                        value={defectModalOrder.id}
                                        onChange={e => {
                                            const selected = defectModalOrderOptions.find(o => o.id === e.target.value);
                                            if (selected) {
                                                setDefectModalOrder(selected);
                                                setDefectNotes(selected.defectNotes || '');
                                            }
                                        }}
                                        style={{
                                            width: '100%',
                                            padding: 'var(--spacing-sm)',
                                            borderRadius: 'var(--radius-sm)',
                                            border: '1px solid var(--color-border)',
                                            fontSize: 'var(--font-size-sm)'
                                        }}
                                    >
                                        {defectModalOrderOptions.map(o => (
                                            <option key={o.id} value={o.id}>{o.productName} ({o.quantity}x)</option>
                                        ))}
                                    </select>
                                </div>
                            ) : (
                                <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                                    Produkt: <strong>{defectModalOrder.productName}</strong>
                                </p>
                            )}`;

if (defectUIRegex.test(content)) {
    content = content.replace(defectUIRegex, newDefectModalUI);
    console.log("Replaced Defect UI");
} else {
    console.log("Could not find Defect UI to replace");
}

// Delivery Date Modal UI Fix
const deliveryUIRegex = /<p style=\{\{ fontSize: 'var\(--font-size-sm\)', color: 'var\(--color-text-muted\)', marginBottom: 'var\(--spacing-md\)' \}\}>\s*Produkt: <strong>\{deliveryDateModalOrder\.productName\}<\/strong>\s*<\/p>/;

const newDeliveryModalUI = `<p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                                {deliveryDateModalOrders && deliveryDateModalOrders.length > 1 ? (
                                    <>Lieferant: <strong>{deliveryDateModalOrder.supplierName || 'Lieferung'}</strong> ({deliveryDateModalOrders.length} Produkte)</>
                                ) : (
                                    <>Produkt: <strong>{deliveryDateModalOrder.productName}</strong></>
                                )}
                            </p>`;

if (deliveryUIRegex.test(content)) {
    content = content.replace(deliveryUIRegex, newDeliveryModalUI);
    console.log("Replaced Delivery UI");
} else {
    console.log("Could not find Delivery UI to replace");
}

fs.writeFileSync(file, content, 'utf8');
