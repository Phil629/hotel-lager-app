const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Products.tsx');
let content = fs.readFileSync(file, 'utf8');

// Replace newProduct state default
content = content.replace(
    `preferredOrderMethod: 'email'`,
    `preferredOrderMethod: undefined`
);

content = content.replace(
    `preferredOrderMethod: 'email'`,
    `preferredOrderMethod: undefined`
);

// Add radio button for "Vom Lieferanten übernehmen"
content = content.replace(
    `<label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}><input type="radio" name="pom" value="email" checked={newProduct.preferredOrderMethod === 'email'} onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: 'email' })} /> <Mail size={16}/> Email</label>`,
    `<label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}><input type="radio" name="pom" value="" checked={!newProduct.preferredOrderMethod} onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: undefined })} /> Vom Lieferanten übernehmen</label>\n                                                    <label style={{ display: 'flex', alignItems: 'center', gap: '6px', cursor: 'pointer' }}><input type="radio" name="pom" value="email" checked={newProduct.preferredOrderMethod === 'email'} onChange={() => setNewProduct({ ...newProduct, preferredOrderMethod: 'email' })} /> <Mail size={16}/> Email</label>`
);

// Update selectedProductForOrder usage
content = content.replace(
    `const [isOrderEmailExpanded, setIsOrderEmailExpanded] = useState(false);`,
    `const [isOrderEmailExpanded, setIsOrderEmailExpanded] = useState(false);\n\n    const getEffectiveOrderMethod = (product: Product) => {\n        if (product.preferredOrderMethod) return product.preferredOrderMethod;\n        const supplier = suppliers.find(s => s.id === product.supplierId);\n        return supplier?.preferredOrderMethod || 'email';\n    };`
);

// We need to replace all instances of `selectedProductForOrder.preferredOrderMethod === 'something'`
// to `getEffectiveOrderMethod(selectedProductForOrder) === 'something'` in the render function.
// Since it's safer to use regex:
content = content.replace(/selectedProductForOrder\.preferredOrderMethod === 'link'/g, `getEffectiveOrderMethod(selectedProductForOrder) === 'link'`);
content = content.replace(/selectedProductForOrder\.preferredOrderMethod === 'phone'/g, `getEffectiveOrderMethod(selectedProductForOrder) === 'phone'`);
content = content.replace(/selectedProductForOrder\.preferredOrderMethod === 'email'/g, `getEffectiveOrderMethod(selectedProductForOrder) === 'email'`);
content = content.replace(/selectedProductForOrder\.preferredOrderMethod !== 'email'/g, `getEffectiveOrderMethod(selectedProductForOrder) !== 'email'`);

fs.writeFileSync(file, content, 'utf8');

const ordersFile = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let ordersContent = fs.readFileSync(ordersFile, 'utf8');

ordersContent = ordersContent.replace(
    `const [isOrderEmailExpanded, setIsOrderEmailExpanded] = useState(false);`,
    `const [isOrderEmailExpanded, setIsOrderEmailExpanded] = useState(false);\n\n    const getEffectiveOrderMethod = (product: Product) => {\n        if (product.preferredOrderMethod) return product.preferredOrderMethod;\n        const supplier = suppliers.find(s => s.id === product.supplierId);\n        return supplier?.preferredOrderMethod || 'email';\n    };`
);

ordersContent = ordersContent.replace(/product\.preferredOrderMethod === 'link'/g, `getEffectiveOrderMethod(product) === 'link'`);
ordersContent = ordersContent.replace(/product\.preferredOrderMethod === 'phone'/g, `getEffectiveOrderMethod(product) === 'phone'`);
ordersContent = ordersContent.replace(/product\.preferredOrderMethod === 'email'/g, `getEffectiveOrderMethod(product) === 'email'`);
ordersContent = ordersContent.replace(/product\.preferredOrderMethod !== 'email'/g, `getEffectiveOrderMethod(product) !== 'email'`);

fs.writeFileSync(ordersFile, ordersContent, 'utf8');

console.log('done product and order update');
