const fs = require('fs');

let c = fs.readFileSync('src/pages/Inventory.tsx', 'utf8');

c = c.replace(/DataService\.updateProduct/g, 'DataService.saveProduct');

fs.writeFileSync('src/pages/Inventory.tsx', c);
