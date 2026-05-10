const fs = require('fs');
let c = fs.readFileSync('src/pages/Orders.tsx', 'utf8');
c = c.replace(/setNotification\\(\\{\\s*message:\\s*'Fehler beim Anlegen der Bestellung.',\\s*type:\\s*'error'\\s*\\}\\);/g, 
  "setNotification({ message: `Fehler: ${error.message || JSON.stringify(error)}`, type: 'error' });");
fs.writeFileSync('src/pages/Orders.tsx', c);
