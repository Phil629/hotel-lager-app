const fs = require('fs');
const path = require('path');

const typesFile = path.join(__dirname, 'src', 'types', 'index.ts');
let typesContent = fs.readFileSync(typesFile, 'utf8');

if (!typesContent.includes('ignoreOrderProposals?: boolean;')) {
    typesContent = typesContent.replace(
        /orderUrl\?: string;\n\}/g,
        `orderUrl?: string;\n  ignoreOrderProposals?: boolean;\n}`
    );
    fs.writeFileSync(typesFile, typesContent, 'utf8');
}
console.log('done types');
