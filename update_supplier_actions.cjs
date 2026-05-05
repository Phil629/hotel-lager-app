const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Add states for modal options
const oldStates = `    const [defectModalOrder, setDefectModalOrder] = useState<Order | null>(null);
    const [defectNotes, setDefectNotes] = useState('');
    const [deliveryDateModalOrder, setDeliveryDateModalOrder] = useState<Order | null>(null);
    const [deliveryDate, setDeliveryDate] = useState('');
    const [deliveryTrackingLink, setDeliveryTrackingLink] = useState('');`;

const newStates = `    const [defectModalOrder, setDefectModalOrder] = useState<Order | null>(null);
    const [defectModalOrderOptions, setDefectModalOrderOptions] = useState<Order[] | null>(null);
    const [defectNotes, setDefectNotes] = useState('');
    const [deliveryDateModalOrder, setDeliveryDateModalOrder] = useState<Order | null>(null);
    const [deliveryDateModalOrders, setDeliveryDateModalOrders] = useState<Order[] | null>(null);
    const [deliveryDate, setDeliveryDate] = useState('');
    const [deliveryTrackingLink, setDeliveryTrackingLink] = useState('');`;

content = content.replace(oldStates, newStates);

// 2. Update open functions
const oldOpenDefect = `    const openDefectModal = (order: Order) => {
        setDefectModalOrder(order);
        setDefectNotes(order.defectNotes || '');
    };

    const closeDefectModal = () => {
        setDefectModalOrder(null);
        setDefectNotes('');
    };`;

const newOpenDefect = `    const openDefectModal = (target: Order | Order[]) => {
        if (Array.isArray(target)) {
            setDefectModalOrderOptions(target);
            setDefectModalOrder(target[0]);
            setDefectNotes(target[0].defectNotes || '');
        } else {
            setDefectModalOrderOptions(null);
            setDefectModalOrder(target);
            setDefectNotes(target.defectNotes || '');
        }
    };

    const closeDefectModal = () => {
        setDefectModalOrder(null);
        setDefectModalOrderOptions(null);
        setDefectNotes('');
    };`;
content = content.replace(oldOpenDefect, newOpenDefect);

const oldOpenDelivery = `    const openDeliveryDateModal = (order: Order) => {
        setDeliveryDateModalOrder(order);
        setDeliveryDate(order.expectedDeliveryDate || '');
        setDeliveryTrackingLink(order.trackingLink || '');
    };

    const closeDeliveryDateModal = () => {
        setDeliveryDateModalOrder(null);
        setDeliveryDate('');
        setDeliveryTrackingLink('');
    };

    const saveDeliveryDate = async () => {
        if (deliveryDateModalOrder) {
            const updatedOrder: Order = {
                ...deliveryDateModalOrder,
                expectedDeliveryDate: deliveryDate || undefined,
                trackingLink: deliveryTrackingLink || undefined
            };
            await DataService.updateOrder(updatedOrder);
            loadOrders();
            closeDeliveryDateModal();
        }
    };`;

const newOpenDelivery = `    const openDeliveryDateModal = (target: Order | Order[]) => {
        if (Array.isArray(target)) {
            setDeliveryDateModalOrders(target);
            setDeliveryDateModalOrder(target[0]);
            setDeliveryDate(target[0].expectedDeliveryDate || '');
            setDeliveryTrackingLink(target[0].trackingLink || '');
        } else {
            setDeliveryDateModalOrders(null);
            setDeliveryDateModalOrder(target);
            setDeliveryDate(target.expectedDeliveryDate || '');
            setDeliveryTrackingLink(target.trackingLink || '');
        }
    };

    const closeDeliveryDateModal = () => {
        setDeliveryDateModalOrder(null);
        setDeliveryDateModalOrders(null);
        setDeliveryDate('');
        setDeliveryTrackingLink('');
    };

    const saveDeliveryDate = async () => {
        if (deliveryDateModalOrders) {
            for (const order of deliveryDateModalOrders) {
                const updatedOrder: Order = {
                    ...order,
                    expectedDeliveryDate: deliveryDate || undefined,
                    trackingLink: deliveryTrackingLink || undefined
                };
                await DataService.updateOrder(updatedOrder);
            }
            loadOrders();
            closeDeliveryDateModal();
        } else if (deliveryDateModalOrder) {
            const updatedOrder: Order = {
                ...deliveryDateModalOrder,
                expectedDeliveryDate: deliveryDate || undefined,
                trackingLink: deliveryTrackingLink || undefined
            };
            await DataService.updateOrder(updatedOrder);
            loadOrders();
            closeDeliveryDateModal();
        }
    };`;
content = content.replace(oldOpenDelivery, newOpenDelivery);

// 3. Update Defect Modal UI
const oldDefectModalUI = `                            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                                Produkt: <strong>{defectModalOrder.productName}</strong>
                            </p>`;

const newDefectModalUI = `                            {defectModalOrderOptions && defectModalOrderOptions.length > 1 ? (
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
content = content.replace(oldDefectModalUI, newDefectModalUI);

// 4. Update Delivery Date Modal UI (show supplier if it's an array)
const oldDeliveryModalUI = `                                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                    <Calendar size={24} color="var(--color-text-main)" />
                                    Liefertermin / Link eintragen
                                </h3>
                                <button onClick={closeDeliveryDateModal} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                    <X size={24} />
                                </button>
                            </div>
                            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                                Produkt: <strong>{deliveryDateModalOrder.productName}</strong>
                            </p>`;

const newDeliveryModalUI = `                                <h3 style={{ margin: 0, display: 'flex', alignItems: 'center', gap: 'var(--spacing-sm)' }}>
                                    <Calendar size={24} color="var(--color-text-main)" />
                                    Liefertermin / Link eintragen
                                </h3>
                                <button onClick={closeDeliveryDateModal} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                                    <X size={24} />
                                </button>
                            </div>
                            <p style={{ fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)', marginBottom: 'var(--spacing-md)' }}>
                                {deliveryDateModalOrders && deliveryDateModalOrders.length > 1 ? (
                                    <>Lieferant: <strong>{deliveryDateModalOrder.supplierName || 'Lieferung'}</strong> ({deliveryDateModalOrders.length} Produkte)</>
                                ) : (
                                    <>Produkt: <strong>{deliveryDateModalOrder.productName}</strong></>
                                )}
                            </p>`;
content = content.replace(oldDeliveryModalUI, newDeliveryModalUI);

// 5. Update Supplier Header to add buttons
const oldSupplierButtons = `<button 
                                            onClick={async (e) => {
                                                e.stopPropagation();
                                                for (const o of supplierOrders) {
                                                    await toggleOrderStatus(o.id);
                                                }
                                                setNotification({ message: \`Alle \${supplierOrders.length} Bestellungen von \${supplierName} wurden als erhalten markiert.\`, type: 'success' });
                                            }}
                                            style={{
                                                padding: '8px 12px',
                                                borderRadius: 'var(--radius-md)',
                                                border: '1px solid #bfdbfe',
                                                backgroundColor: '#eff6ff',
                                                color: '#1d4ed8',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                fontSize: '13px',
                                                fontWeight: 600
                                            }}
                                        >
                                            <CheckSquare size={16} />
                                            Komplette Lieferung erhalten
                                        </button>`;

const newSupplierButtons = `<div style={{ display: 'flex', gap: '8px' }}>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openDeliveryDateModal(supplierOrders);
                                                }}
                                                style={{
                                                    padding: '8px 12px',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: '1px solid var(--color-border)',
                                                    backgroundColor: 'white',
                                                    color: 'var(--color-text-main)',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    fontSize: '13px',
                                                    fontWeight: 600
                                                }}
                                                title="Liefertermin für gesamte Lieferung setzen"
                                            >
                                                <Calendar size={16} />
                                                Termin
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    openDefectModal(supplierOrders);
                                                }}
                                                style={{
                                                    padding: '8px 12px',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: '1px solid #ff9800',
                                                    backgroundColor: 'white',
                                                    color: '#ff9800',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    fontSize: '13px',
                                                    fontWeight: 600
                                                }}
                                                title="Mangel bei einem Produkt der Lieferung melden"
                                            >
                                                <AlertTriangle size={16} />
                                                Mangel
                                            </button>
                                            <button 
                                                onClick={async (e) => {
                                                    e.stopPropagation();
                                                    for (const o of supplierOrders) {
                                                        await toggleOrderStatus(o.id);
                                                    }
                                                    setNotification({ message: \`Alle \${supplierOrders.length} Bestellungen von \${supplierName} wurden als erhalten markiert.\`, type: 'success' });
                                                }}
                                                style={{
                                                    padding: '8px 12px',
                                                    borderRadius: 'var(--radius-md)',
                                                    border: '1px solid #bfdbfe',
                                                    backgroundColor: '#eff6ff',
                                                    color: '#1d4ed8',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '6px',
                                                    fontSize: '13px',
                                                    fontWeight: 600
                                                }}
                                            >
                                                <CheckSquare size={16} />
                                                Erhalten
                                            </button>
                                        </div>`;

content = content.replace(oldSupplierButtons, newSupplierButtons);

fs.writeFileSync(file, content, 'utf8');
console.log('done');
