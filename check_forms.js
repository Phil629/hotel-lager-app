const url = 'https://www.reinigungsberater.de/essigreiniger-reinex-henkelflasche-1-l-p-65805';
fetch(url).then(r => r.text()).then(t => {
  const inputs = [...t.matchAll(/<form[^>]*>.*?<input[^>]*type="number"[^>]*>.*?<\/form>/gis)];
  inputs.forEach(m => console.log('FORM MATCH:', m[0].substring(0, 150)));
});
