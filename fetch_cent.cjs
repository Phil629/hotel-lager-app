const https = require('https');
const fs = require('fs');
https.get('https://www.cent-online.de/gedeckter-tisch/geschirr/schalen-schuesseln/petit-schaelchen-paris.html', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    fs.writeFileSync('cent.html', data);
    console.log('done');
  });
});
