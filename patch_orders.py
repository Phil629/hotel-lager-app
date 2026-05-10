import re

with open('src/pages/Orders.tsx', 'r', encoding='utf-8') as f:
    c = f.read()

# Replace the button block
pattern = r'<button\s*onClick=\{handleCreateOrder\}\s*style=\{\{[\s\S]*?marginTop:\s*\'var\(--spacing-sm\)\'\s*\}\}\s*>\s*Bestellung anlegen\s*</button>'
replacement = """<div style={{ position: 'sticky', bottom: '-24px', backgroundColor: 'var(--color-surface)', padding: '16px 0 0 0', marginTop: '16px', borderTop: '1px solid var(--color-border)', zIndex: 10 }}>
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
                                </div>"""

new_c = re.sub(pattern, replacement, c)

with open('src/pages/Orders.tsx', 'w', encoding='utf-8') as f:
    f.write(new_c)
