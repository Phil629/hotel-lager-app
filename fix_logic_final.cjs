const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

// 1. Add state variables
content = content.replace(
    /const \[visibleReceivedCount, setVisibleReceivedCount\] = useState\(10\);/,
    `const [visibleReceivedCount, setVisibleReceivedCount] = useState(10);\n    const [searchOpenTerm, setSearchOpenTerm] = useState('');\n    const [searchReceivedTerm, setSearchReceivedTerm] = useState('');`
);

// 2. Fix filter logic
content = content.replace(
    /const openOrders = orders\r?\n\s*\.filter\(o => o\.status === 'open'\)/,
    `const openOrders = orders\n        .filter(o => o.status === 'open')\n        .filter(o => {\n            if (!searchOpenTerm) return true;\n            const term = searchOpenTerm.toLowerCase();\n            return o.productName.toLowerCase().includes(term) || (o.supplierName && o.supplierName.toLowerCase().includes(term)) || (o.notes && o.notes.toLowerCase().includes(term));\n        })`
);

content = content.replace(
    /const receivedOrders = orders\r?\n\s*\.filter\(o => o\.status === 'received'\)/,
    `const receivedOrders = orders\n        .filter(o => o.status === 'received')\n        .filter(o => {\n            if (!searchReceivedTerm) return true;\n            const term = searchReceivedTerm.toLowerCase();\n            return o.productName.toLowerCase().includes(term) || (o.supplierName && o.supplierName.toLowerCase().includes(term)) || (o.notes && o.notes.toLowerCase().includes(term));\n        })`
);

fs.writeFileSync(file, content, 'utf8');
console.log('done logic fix final');
