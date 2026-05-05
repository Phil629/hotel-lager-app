const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

const rOpen = `<div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--spacing-lg)', flexWrap: 'wrap', gap: '16px' }}>
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

const lines = content.split(/\r?\n/);

let startIdx = -1;
let endIdx = -1;

for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('Offene Bestellungen')) {
        if (lines[i-1] && lines[i-1].includes('<Clock size={24} />')) {
            startIdx = i - 9; // Approx the start of <h3
            endIdx = i + 1; // Approx </h3>
            break;
        }
    }
}

if (startIdx !== -1) {
    lines.splice(startIdx, endIdx - startIdx + 1, rOpen);
    content = lines.join('\\n'); // Join with \n since the replacement has it
    fs.writeFileSync(file, lines.join('\n'), 'utf8');
}

console.log('done fixing ui open');
