const https = require('https');
https.get('https://www.eofficeshop.de/m%C3%BCllbeutel-papstar-12185-stark-grau-120-l-25-st%C3%BCck.html', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    // print all HTML
    console.log(data);
  });
});
