const fs = require('fs');
let code = fs.readFileSync('src/pages/Products.tsx', 'utf8');

// 1. Replace state declarations
code = code.replace(
    /const \[selectedProductForOrder, setSelectedProductForOrder\] = useState<Product \| null>\(null\);\s*const \[(orderQuantity), set\1\] = useState\(1\);/,
    "const [orderCart, setOrderCart] = useState<{product: Product, quantity: number}[]>([]);"
);

// 2. Refactor handleOrderClick to set orderCart and generate basic templates
const oldHandleOrderClickRegex = /const handleOrderClick = \([\s\S]*?setIsOrderModalOpen\(true\);\s*\};/;
const newHandleOrderClickStr = `
    const generateEmailTemplate = (cart: {product: Product, quantity: number}[]) => {
        if (cart.length === 0) return { subject: '', body: '' };
        const mainProduct = cart[0].product;
        const supplier = suppliers.find(s => s.id === mainProduct.supplierId);
        
        let subject = supplier?.emailSubjectTemplate || mainProduct.emailOrderSubject || \`Bestellung: {product_name}\`;
        let body = supplier?.emailBodyTemplate || mainProduct.emailOrderBody || \`Sehr geehrte Damen und Herren,\\n\\nbitte liefern Sie {quantity}x {product_name} ({unit}).\\n\\nMit freundlichen Grüßen\\nHotel Rezeption\`;

        if (cart.length === 1) {
            subject = subject.replace(/{product_name}/g, mainProduct.name).replace(/{quantity}/g, cart[0].quantity.toString()).replace(/{unit}/g, mainProduct.unit || '');
            body = body.replace(/{product_name}/g, mainProduct.name).replace(/{quantity}/g, cart[0].quantity.toString()).replace(/{unit}/g, mainProduct.unit || '');
        } else {
            const listSubjectInfo = cart.length + " Produkte";
            const listBodyInfo = '\\n' + cart.map(c => \`- \${c.quantity}x \${c.product.name} (\${c.product.unit || ''})\`).join('\\n');
            
            subject = subject.replace(/{quantity}x?\\s*{product_name}(?:\\s*\\({unit}\\))?|{product_name}/g, listSubjectInfo);
            body = body.replace(/{quantity}x?\\s*{product_name}(?:\\s*\\({unit}\\))?|{product_name}/g, listBodyInfo);
        }
        return { subject, body };
    };

    const handleOrderClick = (product: Product) => {
        const initialCart = [{ product, quantity: 1 }];
        setOrderCart(initialCart);
        setOrderDate(new Date().toISOString().split('T')[0]);
        setOrderNotes('');

        const { subject, body } = generateEmailTemplate(initialCart);
        setEmailSubject(subject);
        setEmailBody(body);
        setIsOrderEmailExpanded(product.preferredOrderMethod === 'email');
        setIsOrderModalOpen(true);
    };

    const addToCart = (product: Product) => {
        setOrderCart(prev => {
            const newCart = [...prev, { product, quantity: 1 }];
            const { subject, body } = generateEmailTemplate(newCart);
            setEmailSubject(subject);
            setEmailBody(body);
            return newCart;
        });
    };

    const updateCartQuantity = (index: number, quantity: number) => {
        setOrderCart(prev => {
            const newCart = prev.map((c, i) => i === index ? { ...c, quantity } : c);
            const { subject, body } = generateEmailTemplate(newCart);
            setEmailSubject(subject);
            setEmailBody(body);
            return newCart;
        });
    };

    const removeFromCart = (index: number) => {
        setOrderCart(prev => {
            const newCart = prev.filter((_, i) => i !== index);
            const { subject, body } = generateEmailTemplate(newCart);
            setEmailSubject(subject);
            setEmailBody(body);
            return newCart;
        });
    };
`;

code = code.replace(oldHandleOrderClickRegex, newHandleOrderClickStr);

// 3. Refactor handleCreateOrder
const oldHandleCreateOrderRegex = /const handleCreateOrder = async \([\s\S]*?setIsLoading\(false\);\s*\};/;
const newHandleCreateOrderStr = `
    const handleCreateOrder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (orderCart.length === 0) return;

        setIsLoading(true);
        try {
            const mainProduct = orderCart[0].product;
            if (mainProduct.autoOrder && mainProduct.emailOrderAddress) {
                const settings = StorageService.getSettings();
                if (!settings.serviceId || !settings.templateId || !settings.publicKey) {
                    setNotification({ message: 'Fehler: EmailJS ist nicht konfiguriert.', type: 'error' });
                    setIsLoading(false);
                    return;
                }
                const templateParams = {
                    to_email: mainProduct.emailOrderAddress,
                    subject: emailSubject,
                    message: emailBody,
                    product_name: orderCart.length > 1 ? orderCart.length + " Produkte" : mainProduct.name,
                    quantity: orderCart.length > 1 ? "" : orderCart[0].quantity,
                    unit: orderCart.length > 1 ? "" : mainProduct.unit
                };
                await emailjs.send(settings.serviceId, settings.templateId, templateParams, settings.publicKey);
                setNotification({ message: 'Bestellung wurde automatisch per E-Mail versendet!', type: 'success' });
            }

            for (const item of orderCart) {
                const newOrder: Order = {
                    id: generateId(),
                    date: new Date(orderDate).toISOString(),
                    productName: item.product.name,
                    quantity: item.quantity,
                    status: 'open',
                    productImage: item.product.image,
                    supplierEmail: item.product.emailOrderAddress,
                    supplierPhone: item.product.supplierPhone,
                    notes: orderNotes
                };
                await DataService.saveOrder(newOrder);
            }

            setIsOrderModalOpen(false);
            setOrderCart([]);
            if (!mainProduct.autoOrder) {
                setNotification({ message: 'Bestellung erfolgreich angelegt!', type: 'success' });
            }
        } catch (error) {
            console.error('Order Error:', error);
            setNotification({ message: 'Fehler beim Anlegen der Bestellung.', type: 'error' });
        } finally {
            setIsLoading(false);
        }
    };
`;

code = code.replace(oldHandleCreateOrderRegex, newHandleCreateOrderStr);

// 4. Update Modal render mapping
code = code.replace(
    /isOrderModalOpen && selectedProductForOrder && \(/,
    "isOrderModalOpen && orderCart.length > 0 && ((selectedProductForOrder) => ("
);
code = code.replace(
    /return null;\s*\}\)\(\)\}\s*\{(\/\* Supplier Documents)/,
    "return null;\n                                })()}\n\n                                {$1"
);

// Fix the IIFE closing targeting ONLY the Order Modal END
code = code.replace(
    /Bestellung anlegen\n\s*<\/button>\n\s*<\/div>\n\s*<\/form>\n\s*<\/div>\n\s*<\/div>\n\s*\)\n\s*\}/,
    "Bestellung anlegen\n                                    </button>\n                                </div>\n                            </form>\n                        </div>\n                    </div>\n                ))(orderCart[0].product)\n            }"
);

// Replace the product/quantity fields inside the Modal:
const oldModalProductUI = /<div>\s*<p style=\{\{ margin: '0 0 var\(--spacing-sm\) 0', fontWeight: 500 \}\}>Produkt: \{selectedProductForOrder\.name\}<\/p>\s*<\/div>\s*<div>\s*<label style=\{\{ display: 'block', marginBottom: 'var\(--spacing-xs\)', fontSize: 'var\(--font-size-sm\)', fontWeight: 500 \}\}>Menge \(\{selectedProductForOrder\.unit\}\)<\/label>\s*<input\s*type="number"\s*min="1"\s*required\s*value=\{orderQuantity\}\s*onChange=\{e => \{\s*[\s\S]*?\}\}\s*style=\{[\s\S]*?\}\s*\/>\s*<\/div>/;

const newModalProductUI = `
                                <div>
                                    <h4 style={{ margin: '0 0 var(--spacing-sm) 0', color: 'var(--color-primary)' }}>Bestellübersicht</h4>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: 'var(--spacing-md)' }}>
                                        {orderCart.map((item, index) => (
                                            <div key={item.product.id} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <div style={{ flex: 1, fontWeight: 500, fontSize: 'var(--font-size-md)' }}>{item.product.name} ({item.product.unit})</div>
                                                <input 
                                                    type="number" 
                                                    min="1" 
                                                    value={item.quantity} 
                                                    onChange={e => updateCartQuantity(index, Number(e.target.value))}
                                                    style={{ width: '60px', padding: '6px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)', fontSize: 'var(--font-size-md)' }} 
                                                />
                                                {index > 0 && (
                                                    <button type="button" onClick={() => removeFromCart(index)} style={{ background: 'none', border: 'none', color: 'var(--color-danger)', cursor: 'pointer', padding: '4px' }}>
                                                        <Trash2 size={18} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    
                                    {(() => {
                                        const supplierId = selectedProductForOrder.supplierId;
                                        if (!supplierId) return null;
                                        const suggestions = products.filter(p => p.supplierId === supplierId && !orderCart.some(c => c.product.id === p.id));
                                        if (suggestions.length === 0) return null;
                                        return (
                                            <div style={{ padding: '12px', backgroundColor: 'var(--color-background)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                                                <h5 style={{ margin: '0 0 10px 0', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-muted)' }}>Weitere Produkte vom Lieferanten hinzufügen:</h5>
                                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                                                    {suggestions.map(p => (
                                                        <button 
                                                            key={p.id} 
                                                            type="button"
                                                            onClick={() => addToCart(p)}
                                                            style={{ display: 'flex', alignItems: 'center', gap: '4px', padding: '6px 10px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', backgroundColor: 'var(--color-surface)', fontSize: 'var(--font-size-xs)', cursor: 'pointer', color: 'var(--color-text-main)' }}
                                                        >
                                                            <Plus size={14} /> {p.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
`;

code = code.replace(oldModalProductUI, newModalProductUI);

fs.writeFileSync('src/pages/Products.tsx', code);
console.log("Successfully refactored Products.tsx cart architecture");
