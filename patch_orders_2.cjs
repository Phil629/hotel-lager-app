const fs = require('fs');
let c = fs.readFileSync('src/pages/Orders.tsx', 'utf8');
c = c.replace(/<button[^>]*onClick=\{handleCreateOrder\}[^>]*>\\s*Bestellung anlegen\\s*<\/button>\\s*<\/div>/, `<div style={{ position: 'sticky', bottom: '-24px', backgroundColor: 'var(--color-surface)', padding: '16px 0 0 0', marginTop: '16px', borderTop: '1px solid var(--color-border)', zIndex: 10 }}>
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
                                </div>
                            </div>`);
fs.writeFileSync('src/pages/Orders.tsx', c);
