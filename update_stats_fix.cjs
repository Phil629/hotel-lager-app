const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Statistics.tsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    `formatter={(value: number) => [\`\${value} \${selectedProductData.unit}\`, 'Bestellmenge']}`,
    `formatter={(value: any) => [\`\${value} \${selectedProductData.unit}\`, 'Bestellmenge']}`
);

fs.writeFileSync(file, content, 'utf8');
console.log('fixed formatter');
