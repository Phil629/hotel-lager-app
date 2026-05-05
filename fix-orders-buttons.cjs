const fs = require('fs');
let content = fs.readFileSync('src/pages/Orders.tsx', 'utf8');

const targetContent = `                        {(() => {
                            if (!order.aiRevisions) return null;`;

const replacementContent = `                        {(() => {
                            const product = products.find((p: Product) => p.name === order.productName);
                            if (!product) return null;
                            return (
                                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '12px', marginBottom: '8px' }}>
                                    {product.orderUrl && (
                                        <a
                                            href={product.orderUrl}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                padding: '6px 12px',
                                                backgroundColor: product.preferredOrderMethod === 'link' ? 'var(--color-primary)' : 'white',
                                                color: product.preferredOrderMethod === 'link' ? 'white' : 'var(--color-primary)',
                                                border: '1px solid var(--color-primary)',
                                                borderRadius: '4px',
                                                textDecoration: 'none',
                                                fontSize: '12px',
                                                fontWeight: 500
                                            }}
                                        >
                                            <ExternalLink size={14} />
                                            Zur Webseite {""}
                                            {product.preferredOrderMethod === 'link' && <span style={{ fontSize: '9px', marginLeft: '4px', opacity: 0.8 }}>(Standard)</span>}
                                        </a>
                                    )}
                                    {order.supplierEmail && !product.autoOrder && (
                                        <a
                                            href={\`https://mail.google.com/mail/?view=cm&fs=1&to=\${order.supplierEmail}\`}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                padding: '6px 12px',
                                                backgroundColor: product.preferredOrderMethod === 'email' ? '#EA4335' : 'white',
                                                color: product.preferredOrderMethod === 'email' ? 'white' : '#EA4335',
                                                border: '1px solid #EA4335',
                                                borderRadius: '4px',
                                                textDecoration: 'none',
                                                fontSize: '12px',
                                                fontWeight: 500
                                            }}
                                        >
                                            <Mail size={14} />
                                            Email / Gmail {""}
                                            {product.preferredOrderMethod === 'email' && <span style={{ fontSize: '9px', marginLeft: '4px', opacity: 0.8 }}>(Standard)</span>}
                                        </a>
                                    )}
                                    {(order.supplierPhone || product.supplierPhone) && (
                                        <a
                                            href={\`tel:\${order.supplierPhone || product.supplierPhone}\`}
                                            style={{
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '6px',
                                                padding: '6px 12px',
                                                backgroundColor: product.preferredOrderMethod === 'phone' ? '#ff9800' : 'white',
                                                color: product.preferredOrderMethod === 'phone' ? 'white' : '#ff9800',
                                                border: '1px solid #ff9800',
                                                borderRadius: '4px',
                                                textDecoration: 'none',
                                                fontSize: '12px',
                                                fontWeight: 500
                                            }}
                                        >
                                            <Phone size={14} />
                                            Anrufen {""}
                                            {product.preferredOrderMethod === 'phone' && <span style={{ fontSize: '9px', marginLeft: '4px', opacity: 0.8 }}>(Standard)</span>}
                                        </a>
                                    )}
                                </div>
                            );
                        })()}
                        {(() => {
                            if (!order.aiRevisions) return null;`;

content = content.replace(targetContent, replacementContent);
fs.writeFileSync('src/pages/Orders.tsx', content);
console.log('Successfully injected Quick Action buttons');
