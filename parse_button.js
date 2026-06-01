import fs from 'fs';

const html = fs.readFileSync('C:\\Users\\phdeh\\.gemini\\antigravity\\brain\\405455a8-9b10-49d2-8e63-01658a9f9814\\.system_generated\\steps\\4873\\content.md', 'utf8');

const lowerHtml = html.toLowerCase();
const keywords = ['warenkorb', 'cart', 'basket', 'kaufen', 'bestellen', 'in den'];

console.log("Keyword check:");
for (const kw of keywords) {
  const index = lowerHtml.indexOf(kw);
  console.log(`- '${kw}': index = ${index}`);
  if (index !== -1) {
    console.log(`  Snippet: "...${html.substring(index - 100, index + 200)}..."`);
  }
}
