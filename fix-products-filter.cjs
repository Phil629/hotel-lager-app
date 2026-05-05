const fs = require('fs');
let code = fs.readFileSync('src/pages/Products.tsx', 'utf8');

code = code.replace(
    'const showAll = expandedProductsLimit[supplierId] === true; // default false',
    'const showAll = expandedProductsLimit[supplierId] === true || showLowStockOnly || searchTerm.trim() !== ""; // auto-expand if filtering'
);

fs.writeFileSync('src/pages/Products.tsx', code);
console.log('Modified products to expand when filtering');
