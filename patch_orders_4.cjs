const fs = require('fs');
let c = fs.readFileSync('src/pages/Orders.tsx', 'utf8');

const regex = /<button\\s*onClick=\{handleCreateOrder\}\\s*style=\{\{\\s*width:\\s*'100%',\\s*padding:\\s*'10px',\\s*backgroundColor:\\s*'var\\(--color-primary\\)',\\s*color:\\s*'white',\\s*border:\\s*'none',\\s*borderRadius:\\s*'var\\(--radius-md\\)',\\s*cursor:\\s*'pointer',\\s*fontWeight:\\s*500,\\s*marginTop:\\s*'var\\(--spacing-sm\\)'\\s*\}\}\\s*>\\s*Bestellung anlegen\\s*<\/button>/g;

c = c.replace(regex, `<div style={{ position: 'sticky', bottom: '-24px', backgroundColor: 'var(--color-surface)', padding: '16px 0 0 0', marginTop: '16px', borderTop: '1px solid var(--color-border)', zIndex: 10 }}>
                                    <button
                                        onClick={handleCreateOrder}
                                        style={{
                                            width: '100%',
                                            padding: '12px',
                                            backgroundColor: 'var(--color-primary)',
                                            color: 'white',
                                            border: 'none',
                                            borderRadius: 'var(--radius-md)',
                                            cursor: 'pointer',
                                            fontWeight: 600,
                                            boxShadow: '0 -4px 10px rgba(0,0,0,0.05)'
                                        }}
                                    >
                                        Bestellung anlegen
                                    </button>
                                </div>`);

fs.writeFileSync('src/pages/Orders.tsx', c);
