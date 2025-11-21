export interface Product {
  id: string;
  name: string;
  category: string;
  stock: number;
  minStock?: number;
  unit: string;
  orderUrl?: string;
  image?: string;
  emailOrderAddress?: string;
  emailOrderSubject?: string;
  emailOrderBody?: string;
  autoOrder?: boolean;
}

export interface Order {
  id: string;
  date: string; // ISO string
  productName: string;
  quantity: number;
  status: 'open' | 'received';
  productImage?: string;
}

export interface EmailSettings {
  serviceId: string;
  templateId: string;
  publicKey: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}
