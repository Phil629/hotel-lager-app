const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

content = content.replace(
    /const openDefectModal = \(order: Order\) => \{[\s\S]*?const closeDefectModal = \(\) => \{[\s\S]*?setDefectNotes\(''\);\s*\};/m,
    `const openDefectModal = (target: Order | Order[]) => {
        if (Array.isArray(target)) {
            setDefectModalOrderOptions(target);
            setDefectModalOrder(target[0]);
            setDefectNotes(target[0].defectNotes || '');
        } else {
            setDefectModalOrderOptions(null);
            setDefectModalOrder(target);
            setDefectNotes(target.defectNotes || '');
        }
    };

    const closeDefectModal = () => {
        setDefectModalOrder(null);
        setDefectModalOrderOptions(null);
        setDefectNotes('');
    };`
);

content = content.replace(
    /const openDeliveryDateModal = \(order: Order\) => \{[\s\S]*?const saveDeliveryDate = async \(\) => \{[\s\S]*?closeDeliveryDateModal\(\);\s*\}\s*\};/m,
    `const openDeliveryDateModal = (target: Order | Order[]) => {
        if (Array.isArray(target)) {
            setDeliveryDateModalOrders(target);
            setDeliveryDateModalOrder(target[0]);
            setDeliveryDate(target[0].expectedDeliveryDate || '');
            setDeliveryTrackingLink(target[0].trackingLink || '');
        } else {
            setDeliveryDateModalOrders(null);
            setDeliveryDateModalOrder(target);
            setDeliveryDate(target.expectedDeliveryDate || '');
            setDeliveryTrackingLink(target.trackingLink || '');
        }
    };

    const closeDeliveryDateModal = () => {
        setDeliveryDateModalOrder(null);
        setDeliveryDateModalOrders(null);
        setDeliveryDate('');
        setDeliveryTrackingLink('');
    };

    const saveDeliveryDate = async () => {
        if (deliveryDateModalOrders) {
            for (const order of deliveryDateModalOrders) {
                const updatedOrder: Order = {
                    ...order,
                    expectedDeliveryDate: deliveryDate || undefined,
                    trackingLink: deliveryTrackingLink || undefined
                };
                await DataService.updateOrder(updatedOrder);
            }
            loadOrders();
            closeDeliveryDateModal();
        } else if (deliveryDateModalOrder) {
            const updatedOrder: Order = {
                ...deliveryDateModalOrder,
                expectedDeliveryDate: deliveryDate || undefined,
                trackingLink: deliveryTrackingLink || undefined
            };
            await DataService.updateOrder(updatedOrder);
            loadOrders();
            closeDeliveryDateModal();
        }
    };`
);

fs.writeFileSync(file, content, 'utf8');
console.log('done fixing types');
