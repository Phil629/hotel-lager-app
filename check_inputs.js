const url = process.argv[2];
fetch(url).then(r => r.text()).then(t => {
  const matches = [...t.matchAll(/<input[^>]*type="number"[^>]*>/gi)];
  matches.forEach(m => console.log(m[0]));
});
