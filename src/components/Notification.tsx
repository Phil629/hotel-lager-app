import React, { useEffect, useState } from 'react';
import { CheckCircle, AlertTriangle, X, Info } from 'lucide-react';

export type NotificationType = 'success' | 'error' | 'info';

export interface NotificationProps {
    message: string;
    type?: NotificationType;
    duration?: number;
    onClose: () => void;
}

const CONFIG = {
    success: { icon: CheckCircle, accent: '#22c55e', color: '#15803d', label: 'Erfolg' },
    error:   { icon: AlertTriangle, accent: '#ef4444', color: '#b91c1c', label: 'Fehler' },
    info:    { icon: Info, accent: '#3b82f6', color: '#1d4ed8', label: 'Info' },
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

    const { icon: Icon, accent, color, label } = CONFIG[type];

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
                backgroundColor: `${accent}18`,
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
                style={{
                    flexShrink: 0,
                    marginRight: '4px',
                    marginTop: '2px',
                    background: 'none',
                    border: 'none',
                    padding: '4px',
                    cursor: 'pointer',
                    color: 'var(--color-text-faint)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    transition: 'color 0.15s',
                }}
                onMouseOver={e => e.currentTarget.style.color = 'var(--color-text-muted)'}
                onMouseOut={e => e.currentTarget.style.color = 'var(--color-text-faint)'}
            >
                <X size={15} />
            </button>
        </div>
    );
};
