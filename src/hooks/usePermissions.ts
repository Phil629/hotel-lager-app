import { useAppContext } from '../contexts/AppContext';

export const usePermissions = () => {
    const { userRole, canSeePrices, canManageSuppliers, canSeePasswords, permissionsLoaded } = useAppContext();

    return {
        role: userRole,
        canSeePrices,
        canManageSuppliers,
        canSeePasswords,
        loading: !permissionsLoaded,
    };
};
