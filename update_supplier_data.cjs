const fs = require('fs');
const path = require('path');

// 1. Update types/index.ts
const typesFile = path.join(__dirname, 'src', 'types', 'index.ts');
let typesContent = fs.readFileSync(typesFile, 'utf8');
typesContent = typesContent.replace(
    /preferredOrderMethod\?: 'email' \| 'link' \| 'phone';\s*}/,
    `preferredOrderMethod?: 'email' | 'link' | 'phone';\n  orderEmail?: string;\n  orderPhone?: string;\n  orderUrl?: string;\n}`
);
fs.writeFileSync(typesFile, typesContent, 'utf8');

// 2. Update services/data.ts
const dataFile = path.join(__dirname, 'src', 'services', 'data.ts');
let dataContent = fs.readFileSync(dataFile, 'utf8');

dataContent = dataContent.replace(
    /login_password: s\.loginPassword\s*}\);/,
    `login_password: s.loginPassword,\n    preferred_order_method: s.preferredOrderMethod,\n    order_email: s.orderEmail,\n    order_phone: s.orderPhone,\n    order_url: s.orderUrl\n});`
);

dataContent = dataContent.replace(
    /documents: s\.documents \? \(typeof s\.documents === 'string' \? JSON\.parse\(s\.documents\) : s\.documents\) : \[\]\s*}\);/,
    `documents: s.documents ? (typeof s.documents === 'string' ? JSON.parse(s.documents) : s.documents) : [],\n    preferredOrderMethod: s.preferred_order_method,\n    orderEmail: s.order_email,\n    orderPhone: s.order_phone,\n    orderUrl: s.order_url\n});`
);
fs.writeFileSync(dataFile, dataContent, 'utf8');

console.log('done types and data');
