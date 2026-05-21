import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, X, Info } from 'lucide-react';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';

export interface NotificationProps {
    message: string;
    type?: NotificationType;
    duration?: number;
    onClose: () => void;
}

const CONFIG = {
    success: { icon: CheckCircle, accent: 'var(--color-success)', bg: 'rgba(34, 197, 94, 0.09)',  color: '#15803d', label: 'Erfolg' },
    error:   { icon: AlertTriangle, accent: 'var(--color-danger)',  bg: 'rgba(239, 68, 68, 0.09)', color: '#b91c1c', label: 'Fehler' },
    info:    { icon: Info,          accent: 'var(--color-primary)', bg: 'rgba(37, 99, 235, 0.09)', color: '#1d4ed8', label: 'Info' },
    warning: { icon: AlertTriangle, accent: '#f59e0b',  bg: 'rgba(245, 158, 11, 0.09)', color: '#b45309', label: 'Warnung' },
} as const;

export const Notification: React.FC<NotificationProps> = ({
    message,
    type = 'success',
    duration = 3500,
    onClose,
}) => {
    const [isExiting, setIsExiting] = useState(false);

    const dismiss = () => {
        setIsExiting(true);
        setTimeout(onClose, 280);
    };

    useEffect(() => {
        const t = setTimeout(() => {
            setIsExiting(true);
            setTimeout(onClose, 280);
        }, duration);
        return () => clearTimeout(t);
    }, [duration, onClose]);

    const { icon: Icon, accent, bg, color, label } = CONFIG[type];

    return (
        <div style={{
            position: 'fixed',
            top: '20px',
            right: '20px',
            zIndex: 2000,
            display: 'flex',
            alignItems: 'flex-start',
            gap: '12px',
            padding: '14px 14px 14px 0',
            backgroundColor: 'var(--color-surface)',
            borderLeft: `4px solid ${accent}`,
            borderRadius: 'var(--radius-lg)',
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.12), 0 4px 10px -6px rgba(0,0,0,0.08), 0 0 0 1px rgba(0,0,0,0.04)',
            minWidth: '300px',
            maxWidth: '420px',
            animation: `${isExiting ? 'toast-out' : 'toast-in'} 0.28s ease both`,
        }}>
            {/* Icon circle */}
            <div style={{
                flexShrink: 0,
                width: '36px',
                height: '36px',
                marginLeft: '14px',
                borderRadius: '50%',
                backgroundColor: bg,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: color,
            }}>
                <Icon size={17} />
            </div>

            {/* Text */}
            <div style={{ flex: 1, minWidth: 0, paddingTop: '2px' }}>
                <div style={{
                    fontSize: '11px',
                    fontWeight: 700,
                    color: color,
                    textTransform: 'uppercase',
                    letterSpacing: '0.06em',
                    marginBottom: '3px',
                }}>
                    {label}
                </div>
                <div style={{
                    fontSize: '13.5px',
                    color: 'var(--color-text-secondary)',
                    lineHeight: 1.5,
                    wordBreak: 'break-word',
                }}>
                    {message}
                </div>
            </div>

            {/* Close button */}
            <button
                onClick={dismiss}
                className="toast-close"
                style={{ marginRight: '4px', marginTop: '2px' }}
            >
                <X size={15} />
            </button>
        </div>
    );
};
