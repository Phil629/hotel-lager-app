export interface Supplier {
  id: string;
  name: string;
  contactName?: string;
  email: string;
  phone?: string;
  url?: string;
  notes?: string;
  emailSubjectTemplate?: string;
  emailBodyTemplate?: string;
}

export interface Product {
  id: string;
  name: string;
  category?: string;
  stock: number;
  minStock?: number;
  unit: string;
  orderUrl?: string; // Legacy: Keep for backward compatibility or direct URL orders
  image?: string;
  supplierId?: string; // Link to Supplier
  autoOrder?: boolean;
  notes?: string;
  preferredOrderMethod?: 'email' | 'link';

  // Legacy fields (will be deprecated in favor of Supplier relation, but kept for now)
  emailOrderAddress?: string;
  emailOrderSubject?: string;
  emailOrderBody?: string;
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
  notes?: string; // New: Notes for the order
}

export interface EmailSettings {
  serviceId: string;
  templateId: string;
  publicKey: string;
  supabaseUrl?: string;
  supabaseKey?: string;
}
