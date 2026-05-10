const fs = require('fs');
let lines = fs.readFileSync('src/pages/Orders.tsx', 'utf8').split('\\n');
let newLines = [];
let skip = false;

for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    
    // Check if we hit the button start near line 2268
    if (line.includes('onClick={handleCreateOrder}') && lines[i-1].includes('<button') && i > 2000 && i < 2400) {
        // We found the button for the onetime order form
        newLines.pop(); // Remove the `<button` line
        
        newLines.push("                                <div style={{ position: 'sticky', bottom: '-24px', backgroundColor: 'var(--color-surface)', padding: '16px 0 0 0', marginTop: '16px', borderTop: '1px solid var(--color-border)', zIndex: 10 }}>");
        newLines.push("                                    <button");
        newLines.push("                                        onClick={handleCreateOrder}");
        newLines.push("                                        style={{");
        newLines.push("                                            width: '100%',");
        newLines.push("                                            padding: '12px',");
        newLines.push("                                            backgroundColor: 'var(--color-primary)',");
        newLines.push("                                            color: 'white',");
        newLines.push("                                            border: 'none',");
        newLines.push("                                            borderRadius: 'var(--radius-md)',");
        newLines.push("                                            cursor: 'pointer',");
        newLines.push("                                            fontWeight: 600,");
        newLines.push("                                            boxShadow: '0 -4px 10px rgba(0,0,0,0.05)'");
        newLines.push("                                        }}");
        newLines.push("                                    >");
        newLines.push("                                        Bestellung anlegen");
        newLines.push("                                    </button>");
        newLines.push("                                </div>");
        
        // Skip the next lines until we pass the original </button>
        let j = i;
        while (j < lines.length && !lines[j].includes('</button>')) {
            j++;
        }
        i = j; // skip forward
        continue;
    }
    
    newLines.push(line);
}

fs.writeFileSync('src/pages/Orders.tsx', newLines.join('\\n'));
