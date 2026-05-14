const fs = require('fs');
const glob = require('glob');
const path = require('path');

const files = fs.readdirSync('src/pages').filter(f => f.endsWith('.tsx')).map(f => path.join('src/pages', f));

files.forEach(file => {
    let content = fs.readFileSync(file, 'utf8');
    const originalContent = content;
    
    // Replace backgroundColor: 'white' and background: 'white'
    content = content.replace(/backgroundColor:\s*['"]white['"]/g, 'backgroundColor: \'var(--color-surface)\'');
    content = content.replace(/background:\s*['"]white['"]/g, 'background: \'var(--color-surface)\'');
    
    // Replace #fff and #ffffff
    content = content.replace(/backgroundColor:\s*['"]#fff(?:fff)?['"]/gi, 'backgroundColor: \'var(--color-surface)\'');
    content = content.replace(/background:\s*['"]#fff(?:fff)?['"]/gi, 'background: \'var(--color-surface)\'');

    if (content !== originalContent) {
        fs.writeFileSync(file, content);
        console.log('Updated ' + file);
    }
});
