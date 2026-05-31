const fs = require('fs');
const jsdom = require('jsdom');
const { JSDOM } = jsdom;

const data = fs.readFileSync('eofficeshop_product.html', 'utf8');
const dom = new JSDOM(data);
const document = dom.window.document;

const cartSelector = 'button.add-to-cart, button[name="inInBasket"], input[name="inInBasket"], button[name*="basket" i], button[name*="cart" i], input[name*="basket" i], input[name*="cart" i], button[id*="basket" i], button[id*="cart" i], button[class*="basket" i], button[class*="cart" i], button[title*="warenkorb" i], button[title*="basket" i], button[type="submit"][name*="add"], input[type="submit"][name*="add"], input[type="submit"][value*="warenkorb" i], input[type="image"][src*="warenkorb" i]';

const els = document.querySelectorAll(cartSelector);
console.log('Matches:', els.length);
els.forEach(el => {
  console.log(el.outerHTML);
});

// Also print the button that actually exists
console.log('All submit buttons:');
const submits = document.querySelectorAll('button[type="submit"]');
submits.forEach(s => console.log(s.outerHTML));
