const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Suppliers.tsx');
let content = fs.readFileSync(file, 'utf8');

// Update handleSubmit to include all fields
content = content.replace(
    /const supplierToSave: Supplier = \{\s+id: targetSupplierId,\s+name: formData\.name,\s+contactName: formData\.contactName,\s+email: formData\.email,\s+phone: formData\.phone,\s+url: formData\.url,\s+notes: formData\.notes \|\| \[\],\s+documents: formData\.documents \|\| \[\]\s+\} as Supplier;/g,
    `const supplierToSave: Supplier = {
                id: targetSupplierId,
                name: formData.name,
                contactName: formData.contactName,
                email: formData.email,
                phone: formData.phone,
                url: formData.url,
                notes: formData.notes || [],
                documents: formData.documents || [],
                loginUrl: formData.loginUrl,
                loginUsername: formData.loginUsername,
                loginPassword: formData.loginPassword,
                preferredOrderMethod: formData.preferredOrderMethod,
                orderEmail: formData.orderEmail,
                orderPhone: formData.orderPhone,
                orderUrl: formData.orderUrl
            } as Supplier;`
);

// Update initial state in handleOpenModal
content = content.replace(
    /setFormData\(\{ name: '', contactName: '', email: '', phone: '', url: '', notes: \[\], documents: \[\] \}\);/g,
    `setFormData({ name: '', contactName: '', email: '', phone: '', url: '', notes: [], documents: [], preferredOrderMethod: 'email', orderEmail: '', orderPhone: '', orderUrl: '', loginUrl: '', loginUsername: '', loginPassword: '' });`
);

// Update UI section for preferred order method
const searchUI = `<div style={{ marginTop: '16px' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)' }}>Standard Bestellweg für diesen Lieferanten</label>
                                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                <input type="radio" name="pom_supplier" value="email" checked={formData.preferredOrderMethod === 'email' || !formData.preferredOrderMethod} onChange={() => setFormData({ ...formData, preferredOrderMethod: 'email' })} /> <Mail size={16}/> Email
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                <input type="radio" name="pom_supplier" value="link" checked={formData.preferredOrderMethod === 'link'} onChange={() => setFormData({ ...formData, preferredOrderMethod: 'link' })} /> <ExternalLink size={16}/> Webshop (Link)
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                <input type="radio" name="pom_supplier" value="phone" checked={formData.preferredOrderMethod === 'phone'} onChange={() => setFormData({ ...formData, preferredOrderMethod: 'phone' })} /> <Phone size={16}/> Telefon
                                            </label>
                                        </div>
                                    </div>`;

const replaceUI = `<div style={{ marginTop: '16px', backgroundColor: '#f8fafc', padding: '16px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
                                        <label style={{ display: 'block', marginBottom: '8px', fontWeight: 600, fontSize: '14px', color: 'var(--color-text-main)' }}>Standard Bestellweg für diesen Lieferanten</label>
                                        <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' }}>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                <input type="radio" name="pom_supplier" value="email" checked={formData.preferredOrderMethod === 'email' || !formData.preferredOrderMethod} onChange={() => setFormData({ ...formData, preferredOrderMethod: 'email' })} /> <Mail size={16}/> Email
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                <input type="radio" name="pom_supplier" value="link" checked={formData.preferredOrderMethod === 'link'} onChange={() => setFormData({ ...formData, preferredOrderMethod: 'link' })} /> <ExternalLink size={16}/> Webshop (Link)
                                            </label>
                                            <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}>
                                                <input type="radio" name="pom_supplier" value="phone" checked={formData.preferredOrderMethod === 'phone'} onChange={() => setFormData({ ...formData, preferredOrderMethod: 'phone' })} /> <Phone size={16}/> Telefon
                                            </label>
                                        </div>

                                        {(formData.preferredOrderMethod === 'email' || !formData.preferredOrderMethod) ? (
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#475569' }}>Bestell-Email (Falls abweichend von allgemeiner Email)</label>
                                                <input type="email" value={formData.orderEmail || ''} onChange={e => setFormData({ ...formData, orderEmail: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px' }} placeholder={formData.email || "bestellung@lieferant.de"} />
                                            </div>
                                        ) : formData.preferredOrderMethod === 'link' ? (
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#475569' }}>Bestell-Webseite / Shop URL</label>
                                                <input type="text" value={formData.orderUrl || ''} onChange={e => setFormData({ ...formData, orderUrl: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px' }} placeholder={formData.url || "https://shop.lieferant.de"} />
                                            </div>
                                        ) : (
                                            <div>
                                                <label style={{ display: 'block', marginBottom: '6px', fontSize: '13px', fontWeight: 600, color: '#475569' }}>Bestell-Telefonnummer (Falls abweichend)</label>
                                                <input type="tel" value={formData.orderPhone || ''} onChange={e => setFormData({ ...formData, orderPhone: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '14px' }} placeholder={formData.phone || "+49 123 45678"} />
                                            </div>
                                        )}
                                    </div>`;

content = content.replace(searchUI, replaceUI);

fs.writeFileSync(file, content, 'utf8');
console.log('done updating suppliers component');
