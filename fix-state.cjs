const fs = require('fs');
let c = fs.readFileSync('src/pages/Products.tsx', 'utf8');
c = c.replace(/const \[searchTerm, setSearchTerm\] = useState\(''\);\r?\n    const \[showLowStockOnly, setShowLowStockOnly\] = useState\(false\);/, 
    'const [searchTerm, setSearchTerm] = useState("");\n' +
    '    const [showLowStockOnly, setShowLowStockOnly] = useState(false);\n' +
    '    const [expandedSuppliers, setExpandedSuppliers] = useState<Record<string, boolean>>({});\n' +
    '    const [expandedProductsLimit, setExpandedProductsLimit] = useState<Record<string, boolean>>({});\n' +
    '    const toggleSupplier = (id: string) => setExpandedSuppliers(prev => ({...prev, [id]: prev[id] === false ? true : false}));\n' +
    '    const toggleProductLimit = (id: string) => setExpandedProductsLimit(prev => ({...prev, [id]: !prev[id]}));'
);
c = c.replace('            {\n            {\n                filteredProducts.length === 0 ? (', '            {\n                filteredProducts.length === 0 ? (');
fs.writeFileSync('src/pages/Products.tsx', c);
console.log('Fixed state in Products.tsx');
