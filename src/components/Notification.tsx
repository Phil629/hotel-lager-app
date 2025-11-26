import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, X, Info } from 'lucide-react';

export type NotificationType = 'success' | 'error' | 'info';

export interface NotificationProps {
    message: string;
    type?: NotificationType;
    duration?: number;
    onClose: () => void;
}

export const Notification: React.FC<NotificationProps> = ({
    message,
    type = 'success',
    duration = 3000,
    onClose
}) => {
    const [isVisible, setIsVisible] = useState(true);

    useEffect(() => {
        const timer = setTimeout(() => {
            setIsVisible(false);
            setTimeout(onClose, 300); // Wait for fade out animation
        }, duration);

        return () => clearTimeout(timer);
    }, [duration, onClose]);

    const getIcon = () => {
        switch (type) {
            case 'success': return <CheckCircle size={20} />;
            case 'error': return <AlertTriangle size={20} />;
            case 'info': return <Info size={20} />;
        }
    };

    const getColors = () => {
        switch (type) {
            case 'success': return { bg: '#E6F4EA', border: '#34A853', text: '#1E4620' };
            case 'error': return { bg: '#FCE8E6', border: '#EA4335', text: '#5C1D16' };
            case 'info': return { bg: '#E8F0FE', border: '#4285F4', text: '#174EA6' };
        }
    };

    const colors = getColors();

    if (!isVisible) return null;

    return (
        <div style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 20px',
            backgroundColor: colors.bg,
            borderLeft: `4px solid ${colors.border}`,
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
            color: colors.text,
            minWidth: '300px',
            maxWidth: '450px',
            animation: 'slideIn 0.3s ease-out',
            fontWeight: 500
        }}>
            <div style={{ color: colors.border }}>
                {getIcon()}
            </div>
            <div style={{ flex: 1 }}>
                {message}
            </div>
            <button
                onClick={() => { setIsVisible(false); setTimeout(onClose, 300); }}
                style={{
                    background: 'none',
                    border: 'none',
                    color: 'currentColor',
                    cursor: 'pointer',
                    padding: '4px',
                    opacity: 0.7
                }}
            >
                <X size={16} />
            </button>
            <style>{`
                @keyframes slideIn {
                    from { transform: translateX(100%); opacity: 0; }
                    to { transform: translateX(0); opacity: 1; }
                }
            `}</style>
        </div>
    );
};
