const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

const rOpenBad = `<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap', gap: '16px' }}>
                    <h3 style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-sm)',
                        color: 'var(--color-primary)',
                        margin: 0
                    }}>
                        <Clock size={24} />
                        Offene Bestellungen
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-full)', padding: '6px 16px', border: '1px solid var(--color-border)', flex: '1 1 250px', maxWidth: '400px' }}>
                        <Search size={18} color="var(--color-text-muted)" style={{ marginRight: '8px' }} />
                        <input
                            type="text"
                            placeholder="Offene Bestellungen suchen..."
                            value={searchOpenTerm}
                            onChange={e => setSearchOpenTerm(e.target.value)}
                            style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}
                        />
                    </div>
                </div>`;

const rOpenGood = `<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap', gap: '16px' }}>
                    <h3 style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--spacing-sm)',
                        color: 'var(--color-primary)',
                        margin: 0
                    }}>
                        <Clock size={24} />
                        Offene Bestellungen
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', backgroundColor: 'var(--color-surface)', borderRadius: 'var(--radius-full)', padding: '6px 16px', border: '1px solid var(--color-border)', flex: '1 1 250px', maxWidth: '400px' }}>
                        <Search size={18} color="var(--color-text-muted)" style={{ marginRight: '8px' }} />
                        <input
                            type="text"
                            placeholder="Offene Bestellungen suchen..."
                            value={searchOpenTerm}
                            onChange={e => setSearchOpenTerm(e.target.value)}
                            style={{ border: 'none', background: 'transparent', outline: 'none', width: '100%', fontSize: 'var(--font-size-sm)', color: 'var(--color-text-main)' }}
                        />
                    </div>
                </div>`; // wait, I just need to remove the closing </div> of rReceived? No, it's a sibling div!

// Actually, in the original code, the <h3> is a child of the outer <div>.
// My replacement replaced <h3> with <div class="header"><h3>...</h3><input /></div>. This is perfectly valid JSX!
// WHY did it break?

// Let's check rReceivedBad:
// <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap', gap: '16px' }}>
// ...
// </div>

// If it's valid JSX, then where is the error?
// The error: `src/pages/Orders.tsx(1355,9): error TS2657: JSX expressions must have one parent element.`
