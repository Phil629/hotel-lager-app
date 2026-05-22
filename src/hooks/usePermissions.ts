import { useState, useEffect } from 'react';
import { getSupabaseClient } from '../services/supabase';
import { DataService } from '../services/data';

export const usePermissions = () => {
    const [role, setRole] = useState<string>('');
    const [canSeePrices, setCanSeePrices] = useState<boolean>(false);
    const [canManageSuppliers, setCanManageSuppliers] = useState<boolean>(false);
    const [canSeePasswords, setCanSeePasswords] = useState<boolean>(false);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        let isMounted = true;
        const load = async () => {
            const supabase = getSupabaseClient();
            if (!supabase) {
                if (isMounted) setLoading(false);
                return;
            }
            try {
                const { data: { user } } = await supabase.auth.getUser();
                if (user) {
                    const { data: profile } = await supabase.from('profiles').select('role').eq('id', user.id).single();
                    const r = profile?.role || '';
                    if (isMounted) setRole(r);
                    
                    const settings = await DataService.getCompanySettings();
                    if (isMounted) {
                        setCanSeePrices(r === 'owner' || r === 'admin' || !!settings?.staffCanSeePrices);
                        setCanManageSuppliers(r === 'owner' || r === 'admin' || !!settings?.staffCanManageSuppliers);
                        setCanSeePasswords(r === 'owner' || r === 'admin' || !!settings?.staffCanSeePasswords);
                    }
                }
            } catch (e) {
                console.error('Error loading permissions', e);
            } finally {
                if (isMounted) setLoading(false);
            }
        };
        load();
        return () => { isMounted = false; };
    }, []);

    return { role, canSeePrices, canManageSuppliers, canSeePasswords, loading };
};
