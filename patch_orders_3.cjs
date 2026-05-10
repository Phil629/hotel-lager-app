const fs = require('fs');
let c = fs.readFileSync('src/pages/Orders.tsx', 'utf8');
const searchStr = `                                <button
                                    onClick={handleCreateOrder}
                                    style={{
                                        width: '100%',
                                        padding: '10px',
                                        backgroundColor: 'var(--color-primary)',
                                        color: 'white',
                                        border: 'none',
                                        borderRadius: 'var(--radius-md)',
                                        cursor: 'pointer',
                                        fontWeight: 500,
                                        marginTop: 'var(--spacing-sm)'
                                    }}
                                >
                                    Bestellung anlegen
                                </button>
                            </div>`;
const replaceStr = `                                <div style={{ position: 'sticky', bottom: '-24px', backgroundColor: 'var(--color-surface)', padding: '16px 0 0 0', marginTop: '16px', borderTop: '1px solid var(--color-border)', zIndex: 10 }}>
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
                            </div>`;
// Just do a global string replace normalizing line endings
c = c.replace(/\\r\\n/g, '\\n');
c = c.replace(searchStr.replace(/\\r\\n/g, '\\n'), replaceStr.replace(/\\r\\n/g, '\\n'));
fs.writeFileSync('src/pages/Orders.tsx', c);
