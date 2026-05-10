const fs = require('fs');
let lines = fs.readFileSync('src/pages/Orders.tsx', 'utf8').split(/\r?\n/);
let start = lines.findIndex(l => l.includes('<button') && l.includes('onClick={handleCreateOrder}'));

if (start > 0) {
    let end = start;
    while (!lines[end].includes('</button>')) end++;
    
    // We found the block
    const newBlock = [
        '                                <div style={{ position: "sticky", bottom: "-24px", backgroundColor: "var(--color-surface)", padding: "16px 0 0 0", marginTop: "16px", borderTop: "1px solid var(--color-border)", zIndex: 10 }}>',
        '                                    <button',
        '                                        onClick={handleCreateOrder}',
        '                                        style={{',
        '                                            width: "100%",',
        '                                            padding: "12px",',
        '                                            backgroundColor: "var(--color-primary)",',
        '                                            color: "white",',
        '                                            border: "none",',
        '                                            borderRadius: "var(--radius-md)",',
        '                                            cursor: "pointer",',
        '                                            fontWeight: 600,',
        '                                            boxShadow: "0 -4px 10px rgba(0,0,0,0.05)"',
        '                                        }}',
        '                                    >',
        '                                        Bestellung anlegen',
        '                                    </button>',
        '                                </div>'
    ];
    
    lines.splice(start, end - start + 1, ...newBlock);
    fs.writeFileSync('src/pages/Orders.tsx', lines.join('\r\n'));
    console.log("Patched successfully");
} else {
    console.log("Could not find button");
}
