import { createContext, useContext } from 'react';

interface AppContextValue {
  userRole: string;
  currentPlan: 'basic' | 'standard' | 'pro';
  isAdmin: boolean;
  canSeePrices: boolean;
  canManageSuppliers: boolean;
  canSeePasswords: boolean;
  permissionsLoaded: boolean;
}

const defaultValue: AppContextValue = {
  userRole: '',
  currentPlan: 'basic',
  isAdmin: false,
  canSeePrices: false,
  canManageSuppliers: false,
  canSeePasswords: false,
  permissionsLoaded: false,
};

export const AppContext = createContext<AppContextValue>(defaultValue);
export const useAppContext = () => useContext(AppContext);
