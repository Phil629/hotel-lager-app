const https = require('https');

https.get('https://www.cent-online.de/gedeckter-tisch/geschirr/schalen-schuesseln/petit-schaelchen-paris.html', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    const lines = data.split('\n');
    lines.forEach(l => {
      if (l.toLowerCase().includes('warenkorb') && l.includes('href=')) {
        console.log(l.trim());
      }
    });
  });
});
