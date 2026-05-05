const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Auth.tsx');
let content = fs.readFileSync(file, 'utf8');

// Fix styling and add name/id to inputs for password manager
content = content.replace(
    `<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '80vh' }}>`,
    `<div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', width: '100vw', position: 'fixed', top: 0, left: 0, backgroundColor: 'var(--color-background)', zIndex: 9999 }}>`
);

content = content.replace(
    `<label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>E-Mail Adresse</label>`,
    `<label htmlFor="email" style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>E-Mail Adresse</label>`
);

content = content.replace(
    `autoComplete={isLogin ? "username" : "email"}`,
    `id="email"\n                            name="email"\n                            autoComplete={isLogin ? "username" : "email"}`
);

content = content.replace(
    `<label style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Passwort</label>`,
    `<label htmlFor="password" style={{ display: 'block', marginBottom: 'var(--spacing-xs)', fontSize: 'var(--font-size-sm)', fontWeight: 600 }}>Passwort</label>`
);

content = content.replace(
    `autoComplete={isLogin ? "current-password" : "new-password"}`,
    `id="password"\n                                name="password"\n                                autoComplete={isLogin ? "current-password" : "new-password"}`
);

fs.writeFileSync(file, content, 'utf8');
console.log('done');
