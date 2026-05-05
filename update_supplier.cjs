const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'types', 'index.ts');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    `documents?: { name: string; url: string; date?: string; }[];`,
    `documents?: { name: string; url: string; date?: string; }[];\n  preferredOrderMethod?: 'email' | 'link' | 'phone';`
);

fs.writeFileSync(file, content, 'utf8');
console.log('done index.ts');

const dataFile = path.join(__dirname, 'src', 'services', 'data.ts');
let dataContent = fs.readFileSync(dataFile, 'utf8');

dataContent = dataContent.replace(
    `documents: s.documents,`,
    `documents: s.documents,\n            preferred_order_method: s.preferredOrderMethod,`
);

dataContent = dataContent.replace(
    `documents: s.documents || [],`,
    `documents: s.documents || [],\n            preferredOrderMethod: s.preferred_order_method,`
);

fs.writeFileSync(dataFile, dataContent, 'utf8');
console.log('done data.ts');
