import { createClient } from '@supabase/supabase-js';
import { StorageService } from './storage';

// We need to create the client dynamically because the URL and Key come from localStorage
// and might change at runtime.

export const getSupabaseClient = () => {
    const settings = StorageService.getSettings();

    if (settings.supabaseUrl && settings.supabaseKey) {
        return createClient(settings.supabaseUrl, settings.supabaseKey);
    }

    return null;
};
