const fs = require('fs');
let code = fs.readFileSync('src/pages/Orders.tsx', 'utf8');

code = code.replace(
    "window.open(webshopUrl, '_blank');", 
    `if (!webshopUrl || webshopUrl.trim() === '') {
        setNotification({message: 'Kein Bestelllink hinterlegt!', type: 'error'});
        return;
    }
    window.open(webshopUrl, '_blank');`
);

fs.writeFileSync('src/pages/Orders.tsx', code);
console.log('Fixed window.open in Orders.tsx');
