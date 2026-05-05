const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Fix saveDefect
const saveDefectRegex = /const saveDefect = async \(\) => \{[\s\S]*?if \(defectModalOrder && defectNotes\.trim\(\)\) \{[\s\S]*?try \{[\s\S]*?const updatedOrder: Order = \{[\s\S]*?\.\.\.defectModalOrder,[\s\S]*?hasDefect: true,[\s\S]*?defectNotes: defectNotes\.trim\(\),[\s\S]*?defectReportedAt: new Date\(\)\.toISOString\(\)[\s\S]*?\};[\s\S]*?await DataService\.updateOrder\(updatedOrder\);[\s\S]*?await loadOrders\(\);[\s\S]*?closeDefectModal\(\);[\s\S]*?setNotification\(\{ message: 'Mangel wurde erfolgreich gemeldet!', type: 'success' \}\);[\s\S]*?\} catch \(error: any\) \{[\s\S]*?console\.error\('Error saving defect:', error\);[\s\S]*?const errorMsg = error\?\.message \|\| error\?\.error_description \|\| JSON\.stringify\(error\);[\s\S]*?setNotification\(\{ message: 'Fehler beim Speichern des Mangels: ' \+ errorMsg, type: 'error' \}\);[\s\S]*?\}[\s\S]*?\}[\s\S]*?\};/m;

const newSaveDefect = `    const saveDefect = async () => {
        if (defectModalOrder && defectNotes.trim()) {
            try {
                if (defectModalOrder.id === 'ALL' && defectModalOrderOptions) {
                    for (const order of defectModalOrderOptions) {
                        const updatedOrder: Order = {
                            ...order,
                            hasDefect: true,
                            defectNotes: defectNotes.trim(),
                            defectReportedAt: new Date().toISOString()
                        };
                        await DataService.updateOrder(updatedOrder);
                    }
                } else {
                    const updatedOrder: Order = {
                        ...defectModalOrder,
                        hasDefect: true,
                        defectNotes: defectNotes.trim(),
                        defectReportedAt: new Date().toISOString()
                    };
                    await DataService.updateOrder(updatedOrder);
                }
                await loadOrders();
                closeDefectModal();
                setNotification({ message: 'Mangel wurde erfolgreich gemeldet!', type: 'success' });
            } catch (error: any) {
                console.error('Error saving defect:', error);
                const errorMsg = error?.message || error?.error_description || JSON.stringify(error);
                setNotification({ message: 'Fehler beim Speichern des Mangels: ' + errorMsg, type: 'error' });
            }
        }
    };`;

content = content.replace(saveDefectRegex, newSaveDefect);

// 2. Fix openDefectModal
const openDefectModalRegex = /const openDefectModal = \(target: Order \| Order\[\]\) => \{[\s\S]*?if \(Array\.isArray\(target\)\) \{[\s\S]*?setDefectModalOrderOptions\(target\);[\s\S]*?setDefectModalOrder\(target\[0\]\);[\s\S]*?setDefectNotes\(target\[0\]\.defectNotes \|\| ''\);[\s\S]*?\} else \{[\s\S]*?setDefectModalOrderOptions\(null\);[\s\S]*?setDefectModalOrder\(target\);[\s\S]*?setDefectNotes\(target\.defectNotes \|\| ''\);[\s\S]*?\}[\s\S]*?\};/m;

const newOpenDefectModal = `const openDefectModal = (target: Order | Order[]) => {
        if (Array.isArray(target) && target.length > 1) {
            setDefectModalOrderOptions(target);
            setDefectModalOrder({ id: 'ALL', productName: 'Alle Produkte der Lieferung', quantity: 0 } as any);
            setDefectNotes('');
        } else if (Array.isArray(target) && target.length === 1) {
            setDefectModalOrderOptions(null);
            setDefectModalOrder(target[0]);
            setDefectNotes(target[0].defectNotes || '');
        } else if (!Array.isArray(target)) {
            setDefectModalOrderOptions(null);
            setDefectModalOrder(target);
            setDefectNotes(target.defectNotes || '');
        }
    };`;

content = content.replace(openDefectModalRegex, newOpenDefectModal);

// 3. Fix Defect Modal Select Options
const selectRegex = /<select[\s\S]*?value=\{defectModalOrder\.id\}[\s\S]*?onChange=\{e => \{[\s\S]*?const selected = defectModalOrderOptions\.find\(o => o\.id === e\.target\.value\);[\s\S]*?if \(selected\) \{[\s\S]*?setDefectModalOrder\(selected\);[\s\S]*?setDefectNotes\(selected\.defectNotes \|\| ''\);[\s\S]*?\}[\s\S]*?\}\}[\s\S]*?style=\{\{[\s\S]*?width: '100%',[\s\S]*?padding: 'var\(--spacing-sm\)',[\s\S]*?borderRadius: 'var\(--radius-sm\)',[\s\S]*?border: '1px solid var\(--color-border\)',[\s\S]*?fontSize: 'var\(--font-size-sm\)'[\s\S]*?\}\}[\s\S]*?>[\s\S]*?\{defectModalOrderOptions\.map\(o => \([\s\S]*?<option key=\{o\.id\} value=\{o\.id\}>\{o\.productName\} \(\{o\.quantity\}x\)<\/option>[\s\S]*?\)\}[\s\S]*?<\/select>/m;

const newSelect = `<select
                                        value={defectModalOrder.id}
                                        onChange={e => {
                                            if (e.target.value === 'ALL') {
                                                setDefectModalOrder({ id: 'ALL', productName: 'Alle Produkte der Lieferung', quantity: 0 } as any);
                                                setDefectNotes('');
                                            } else {
                                                const selected = defectModalOrderOptions.find(o => o.id === e.target.value);
                                                if (selected) {
                                                    setDefectModalOrder(selected);
                                                    setDefectNotes(selected.defectNotes || '');
                                                }
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
                                        <option value="ALL">Alle Produkte der Lieferung</option>
                                        {defectModalOrderOptions.map(o => (
                                            <option key={o.id} value={o.id}>{o.productName} ({o.quantity}x)</option>
                                        ))}
                                    </select>`;

content = content.replace(selectRegex, newSelect);

// 4. Fix "Bearbeiten" Mangel entfernen
const bearbeitenMangelRegex = /onClick=\{\(\) => \{[\s\S]*?const updated = \{ \.\.\.editingOrder \};[\s\S]*?delete updated\.hasDefect;[\s\S]*?delete updated\.defectNotes;[\s\S]*?delete updated\.defectReportedAt;[\s\S]*?delete updated\.defectResolved;[\s\S]*?setEditingOrder\(updated\);[\s\S]*?\}\}/m;

const newBearbeitenMangel = `onClick={() => {
                                                    setEditingOrder({
                                                        ...editingOrder,
                                                        hasDefect: false,
                                                        defectNotes: null as unknown as string,
                                                        defectReportedAt: null as unknown as string,
                                                        defectResolved: null as unknown as boolean
                                                    });
                                                }}`;

content = content.replace(bearbeitenMangelRegex, newBearbeitenMangel);

fs.writeFileSync(file, content, 'utf8');
console.log('Done');
