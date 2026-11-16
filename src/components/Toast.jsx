import React from 'react';
import { useStore } from '../store.jsx';
import { CheckIcon, AlertIcon, InfoIcon } from './Icons.jsx';

const ICONS = {
  success: CheckIcon,
  error: AlertIcon,
  info: InfoIcon,
};

export default function Toast() {
  const { toast } = useStore();
  if (!toast) return null;
  const Icon = ICONS[toast.tone] || InfoIcon;
  return (
    <div key={toast.id} className={`toast toast-${toast.tone}`} role="status">
      <span className="toast-icon">
        <Icon size={16} />
      </span>
      <span>{toast.message}</span>
    </div>
  );
}
