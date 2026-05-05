const fs = require('fs');
const path = require('path');

// 1. types/index.ts
const typesFile = path.join(__dirname, 'src', 'types', 'index.ts');
let typesContent = fs.readFileSync(typesFile, 'utf8');
typesContent = typesContent.replace(/email: string;/g, 'email?: string;');
fs.writeFileSync(typesFile, typesContent, 'utf8');

// 2. Suppliers.tsx
const suppliersFile = path.join(__dirname, 'src', 'pages', 'Suppliers.tsx');
let suppliersContent = fs.readFileSync(suppliersFile, 'utf8');

suppliersContent = suppliersContent.replace(
    /if \(\!formData\.name \|\| \!formData\.email\) \{/,
    `if (!formData.name) {`
);
suppliersContent = suppliersContent.replace(
    /setNotification\(\{ message: 'Name und Email sind Pflichtfelder.', type: 'error' \}\);/,
    `setNotification({ message: 'Name ist ein Pflichtfeld.', type: 'error' });`
);

fs.writeFileSync(suppliersFile, suppliersContent, 'utf8');

console.log('done email optional');
