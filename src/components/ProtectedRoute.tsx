import React from 'react';
import { Navigate, useLocation } from 'react-router-dom';
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
    const location = useLocation();

    if (!session) {
        return <Navigate to="/auth" replace state={{ from: location.pathname }} />;
    }

    if (requiredRole && userRole !== requiredRole) {
        return <Navigate to="/products" replace />;
    }

    return <>{children}</>;
};
