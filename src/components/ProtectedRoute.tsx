import React from 'react';
import { Navigate } from 'react-router-dom';

interface ProtectedRouteProps {
    session: any;
    children: React.ReactNode;
}

export const ProtectedRoute: React.FC<ProtectedRouteProps> = ({ session, children }) => {
    if (!session) {
        return <Navigate to="/auth" replace />;
    }
    return <>{children}</>;
};
