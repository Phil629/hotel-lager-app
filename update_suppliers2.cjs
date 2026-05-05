const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Suppliers.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Imports
content = content.replace(
    `import { Plus, Edit2, Trash2, Mail, Phone, Search, X, AlertTriangle, Package, CheckSquare, Square, Globe, Key, Eye, EyeOff } from 'lucide-react';`,
    `import { Plus, Edit2, Trash2, Mail, Phone, Search, X, AlertTriangle, Package, CheckSquare, Square, Globe, Key, Eye, EyeOff, ExternalLink } from 'lucide-react';`
);

// 2. formData state
content = content.replace(
    `name: '', contactName: '', email: '', phone: '', url: '', notes: []`,
    `name: '', contactName: '', email: '', phone: '', url: '', notes: [], preferredOrderMethod: 'email'`
);

// 3. handleOpenModal reset
content = content.replace(
    `setFormData({ name: '', contactName: '', email: '', phone: '', url: '', notes: [], documents: [] });`,
    `setFormData({ name: '', contactName: '', email: '', phone: '', url: '', notes: [], documents: [], preferredOrderMethod: 'email' });`
);

// 4. handleSubmit target
content = content.replace(
    `documents: formData.documents || []\n            } as Supplier;`,
    `documents: formData.documents || [],\n                preferredOrderMethod: formData.preferredOrderMethod || 'email'\n            } as Supplier;`
);

// 5. Add UI logic after the URL field or inside the portal login section
// I will append it after the "Email Adresse (Bestellung)" and "Webseite" grid.
const searchStr = `                                            <input type="text" value={formData.url || ''} onChange={e => setFormData({ ...formData, url: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }} placeholder="www.beispiel.de" />
                                        </div>
                                    </div>
                                </div>`;

const replaceStr = `                                            <input type="text" value={formData.url || ''} onChange={e => setFormData({ ...formData, url: e.target.value })} style={{ width: '100%', padding: '10px 14px', borderRadius: '8px', border: '1px solid #cbd5e1', fontSize: '15px' }} placeholder="www.beispiel.de" />
                                        </div>
                                    </div>

                                    <div style={{ marginTop: '16px' }}>
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
                                    </div>
                                </div>`;

content = content.replace(searchStr, replaceStr);

fs.writeFileSync(file, content, 'utf8');
console.log('done suppliers update');
