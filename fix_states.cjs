const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, 'src', 'pages', 'Orders.tsx');
let content = fs.readFileSync(file, 'utf8');

const regex = /const \[defectModalOrder, setDefectModalOrder\] = useState<Order \| null>\(null\);[\s\S]*?const \[deliveryTrackingLink, setDeliveryTrackingLink\] = useState\(''\);/;

const replacement = `const [defectModalOrder, setDefectModalOrder] = useState<Order | null>(null);
    const [defectModalOrderOptions, setDefectModalOrderOptions] = useState<Order[] | null>(null);
    const [defectNotes, setDefectNotes] = useState('');
    const [deliveryDateModalOrder, setDeliveryDateModalOrder] = useState<Order | null>(null);
    const [deliveryDateModalOrders, setDeliveryDateModalOrders] = useState<Order[] | null>(null);
    const [deliveryDate, setDeliveryDate] = useState('');
    const [deliveryTrackingLink, setDeliveryTrackingLink] = useState('');`;

if (regex.test(content)) {
    content = content.replace(regex, replacement);
    fs.writeFileSync(file, content, 'utf8');
    console.log('Fixed states');
} else {
    console.log('Could not find states');
}
