const fs = require('fs');
const path = require('path');

const productsFile = path.join(__dirname, 'src', 'pages', 'Products.tsx');
let productsContent = fs.readFileSync(productsFile, 'utf8');

// Update Email fallback in handleGenerateOrderText
productsContent = productsContent.replace(
    /const targetEmail = selectedProductForOrder\.emailOrderAddress \|\| supplier\?\.email;/,
    `const targetEmail = selectedProductForOrder.emailOrderAddress || supplier?.orderEmail || supplier?.email;`
);
productsContent = productsContent.replace(
    /const supplierEmail = suppliers\.find\(s => s\.id === selectedProductForOrder\.supplierId\)\?\.email;/,
    `const supplier = suppliers.find(s => s.id === selectedProductForOrder.supplierId);\n                                            const supplierEmail = selectedProductForOrder.emailOrderAddress || supplier?.orderEmail || supplier?.email;`
);

// Update Link rendering
productsContent = productsContent.replace(
    /\{selectedProductForOrder\.orderUrl && \(/,
    `{(selectedProductForOrder.orderUrl || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.orderUrl || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.url) && (`
);
productsContent = productsContent.replace(
    /href=\{selectedProductForOrder\.orderUrl\}/g,
    `href={selectedProductForOrder.orderUrl || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.orderUrl || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.url}`
);

// Update Phone rendering
productsContent = productsContent.replace(
    /\{\(selectedProductForOrder\.supplierPhone \|\| \(suppliers\.find\(s => s\.id === selectedProductForOrder\.supplierId\)\?\.phone\)\) && \(/g,
    `{(selectedProductForOrder.supplierPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.orderPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.phone) && (`
);
productsContent = productsContent.replace(
    /href=\{\`tel:\$\{selectedProductForOrder\.supplierPhone \|\| suppliers\.find\(s => s\.id === selectedProductForOrder\.supplierId\)\?\.phone\}\`\}/g,
    `href={\`tel:\${selectedProductForOrder.supplierPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.orderPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.phone}\`}`
);
productsContent = productsContent.replace(
    /\{selectedProductForOrder\.supplierPhone \|\| suppliers\.find\(s => s\.id === selectedProductForOrder\.supplierId\)\?\.phone\}/g,
    `{selectedProductForOrder.supplierPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.orderPhone || suppliers.find(s => s.id === selectedProductForOrder.supplierId)?.phone}`
);

fs.writeFileSync(productsFile, productsContent, 'utf8');

// Now Orders.tsx
const ordersFile = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let ordersContent = fs.readFileSync(ordersFile, 'utf8');

// Similar replacements for Orders.tsx
ordersContent = ordersContent.replace(
    /\{productForOrder\.orderUrl && \(/g,
    `{(productForOrder.orderUrl || suppliers.find(s => s.name === productForOrder.supplierName)?.orderUrl || suppliers.find(s => s.name === productForOrder.supplierName)?.url) && (`
);
ordersContent = ordersContent.replace(
    /href=\{productForOrder\.orderUrl\}/g,
    `href={productForOrder.orderUrl || suppliers.find(s => s.name === productForOrder.supplierName)?.orderUrl || suppliers.find(s => s.name === productForOrder.supplierName)?.url}`
);

ordersContent = ordersContent.replace(
    /\{\(productForOrder\.supplierPhone \|\| \(suppliers\.find\(s => s\.name === productForOrder\.supplierName\)\?\.phone\)\) && \(/g,
    `{(productForOrder.supplierPhone || suppliers.find(s => s.name === productForOrder.supplierName)?.orderPhone || suppliers.find(s => s.name === productForOrder.supplierName)?.phone) && (`
);
ordersContent = ordersContent.replace(
    /href=\{\`tel:\$\{productForOrder\.supplierPhone \|\| suppliers\.find\(s => s\.name === productForOrder\.supplierName\)\?\.phone\}\`\}/g,
    `href={\`tel:\${productForOrder.supplierPhone || suppliers.find(s => s.name === productForOrder.supplierName)?.orderPhone || suppliers.find(s => s.name === productForOrder.supplierName)?.phone}\`}`
);
ordersContent = ordersContent.replace(
    /\{productForOrder\.supplierPhone \|\| suppliers\.find\(s => s\.name === productForOrder\.supplierName\)\?\.phone\}/g,
    `{productForOrder.supplierPhone || suppliers.find(s => s.name === productForOrder.supplierName)?.orderPhone || suppliers.find(s => s.name === productForOrder.supplierName)?.phone}`
);

fs.writeFileSync(ordersFile, ordersContent, 'utf8');

console.log('done products and orders logic');
