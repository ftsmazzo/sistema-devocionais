import { useEffect } from 'react';
import { CheckCircle2, XCircle, Info, AlertCircle, X } from 'lucide-react';

interface ToastProps {
  message: string;
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
  onClose: () => void;
}

export default function Toast({ message, type = 'info', duration = 3000, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(() => {
      onClose();
    }, duration);

    return () => clearTimeout(timer);
  }, [duration, onClose]);

  const icons = {
    success: CheckCircle2,
    error: XCircle,
    info: Info,
    warning: AlertCircle,
  };

  const colors = {
    success: 'bg-green-50 border-green-200 text-green-800',
    error: 'bg-red-50 border-red-200 text-red-800',
    info: 'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
  };

  const iconColors = {
    success: 'text-green-600',
    error: 'text-red-600',
    info: 'text-blue-600',
    warning: 'text-amber-600',
  };

  const Icon = icons[type];

  return (
    <div 
      className="fixed top-20 right-4 z-[99999] max-w-md w-[calc(100%-2rem)] sm:w-auto"
      style={{ 
        position: 'fixed',
        top: '80px',
        right: '16px',
        zIndex: 99999,
      }}
    >
      <div 
        className={`flex items-start gap-2.5 px-4 py-3 rounded-xl border-2 shadow-2xl ${colors[type]}`}
        style={{ 
          animation: 'slideIn 0.3s ease-out'
        }}
      >
        <Icon className={`h-5 w-5 ${iconColors[type]} flex-shrink-0 mt-0.5`} />
        <p className="text-sm font-medium flex-1 break-words whitespace-normal leading-relaxed pr-2">{message}</p>
        <button
          onClick={onClose}
          className={`${iconColors[type]} hover:opacity-70 transition-opacity flex-shrink-0`}
          aria-label="Fechar"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <style>{`
        @keyframes slideIn {
          from {
            transform: translateX(100%);
            opacity: 0;
          }
          to {
            transform: translateX(0);
            opacity: 1;
          }
        }
      `}</style>
    </div>
  );
}
