const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

const t1 = `    const openOrders = orders\r\n        .filter(o => o.status === 'open')`;
const r1 = `    const openOrders = orders\r\n        .filter(o => o.status === 'open')\n        .filter(o => {\n            if (!searchOpenTerm) return true;\n            const term = searchOpenTerm.toLowerCase();\n            return o.productName.toLowerCase().includes(term) || (o.supplierName && o.supplierName.toLowerCase().includes(term)) || (o.notes && o.notes.toLowerCase().includes(term));\n        })`;

const t1_unix = `    const openOrders = orders\n        .filter(o => o.status === 'open')`;

if (content.includes(t1)) {
    content = content.replace(t1, r1);
} else if (content.includes(t1_unix)) {
    content = content.replace(t1_unix, r1);
}

const t2 = `    const receivedOrders = orders\r\n        .filter(o => o.status === 'received')`;
const r2 = `    const receivedOrders = orders\r\n        .filter(o => o.status === 'received')\n        .filter(o => {\n            if (!searchReceivedTerm) return true;\n            const term = searchReceivedTerm.toLowerCase();\n            return o.productName.toLowerCase().includes(term) || (o.supplierName && o.supplierName.toLowerCase().includes(term)) || (o.notes && o.notes.toLowerCase().includes(term));\n        })`;
const t2_unix = `    const receivedOrders = orders\n        .filter(o => o.status === 'received')`;

if (content.includes(t2)) {
    content = content.replace(t2, r2);
} else if (content.includes(t2_unix)) {
    content = content.replace(t2_unix, r2);
}

fs.writeFileSync(file, content, 'utf8');
console.log('done fixing orders search logic');
