const fs = require('fs');
let lines = fs.readFileSync('src/pages/Products.tsx', 'utf8').split('\n');

// Line 2222 is index 2221
if (lines[2221].includes(')')) {
    lines[2221] = "                ))(orderCart[0].product)";
    fs.writeFileSync('src/pages/Products.tsx', lines.join('\n'));
    console.log("Replaced line 2222 successfully.");
} else {
    console.log("Error: Line 2222 doesn't look right: " + lines[2221]);
}
