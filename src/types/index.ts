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
  supplierPhone?: string;
}

export interface Order {
  id: string;
  date: string; // ISO string
  productName: string;
  quantity: number;
  status: 'open' | 'received';
  productImage?: string;
  hasDefect?: boolean;
  defectNotes?: string;
  defectReportedAt?: string; // ISO string
  defectResolved?: boolean; // New: Track if defect is resolved
  expectedDeliveryDate?: string; // ISO string
  supplierName?: string; // New: Supplier name for one-time orders
  orderNumber?: string; // New: Order number for tracking
  price?: number; // New: Price of the order
  supplierEmail?: string; // Cached from product for easy access
  supplierPhone?: string; // Cached from product for easy access
  receivedAt?: string; // ISO string, timestamp when order was marked as received
}

export interface EmailSettings {
  serviceId: string;
  templateId: string;
  publicKey: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}
