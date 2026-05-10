import React from 'react';
import { Navigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';

interface ProtectedRouteProps {
    session: Session | null;
    children: React.ReactNode;
    // K2: optionale Rollenprüfung (serverseitig durch RLS doppelt gesichert)
    requiredRole?: string;
    userRole?: string;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
    session,
    children,
    requiredRole,
    userRole,
}) => {
    if (!session) {
        return <Navigate to="/auth" replace />;
    }

    if (requiredRole && userRole !== requiredRole) {
        return <Navigate to="/products" replace />;
    }

    return <>{children}</>;
};
