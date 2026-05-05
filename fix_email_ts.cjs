const fs = require('fs');
const path = require('path');

// 1. Orders.tsx
const ordersFile = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let ordersContent = fs.readFileSync(ordersFile, 'utf8');

ordersContent = ordersContent.replace(
    /supplierEmail: supplier\.email,/,
    `supplierEmail: supplier.email || '',`
);
fs.writeFileSync(ordersFile, ordersContent, 'utf8');

// 2. Suppliers.tsx
const suppliersFile = path.join(__dirname, 'src', 'pages', 'Suppliers.tsx');
let suppliersContent = fs.readFileSync(suppliersFile, 'utf8');

suppliersContent = suppliersContent.replace(
    /s\.email\.toLowerCase\(\)\.includes\(searchTerm\.toLowerCase\(\)\)/,
    `(s.email || '').toLowerCase().includes(searchTerm.toLowerCase())`
);

suppliersContent = suppliersContent.replace(
    /email: formData\.email,/,
    `email: formData.email || '',` // To make sure formData.email doesn't stay undefined if passed around though in UI it defaults to ''
);

fs.writeFileSync(suppliersFile, suppliersContent, 'utf8');

console.log('done fixing TS');
