import type React from 'react';
import { Trash2 } from 'lucide-react';

/* ---- Generic settings building blocks ---- */

export function Toggle({ enabled, onToggle }: { enabled: boolean; onToggle: () => void }) {
  return (
    <button
      role="switch"
      aria-checked={enabled}
      onClick={onToggle}
      className={`w-10 h-6 rounded-full relative transition-colors duration-200 ${
        enabled ? 'bg-accent' : 'bg-white/20'
      }`}
    >
      <div
        className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
          enabled ? 'right-0.5' : 'left-0.5'
        }`}
      />
    </button>
  );
}

export function Section({
  title,
  icon,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="glass-card p-6 mb-6">
      <div className="flex items-center gap-2 mb-5">
        {icon}
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      {children}
    </div>
  );
}

export function SettingRow({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-4 py-3 border-b border-card-border/35 last:border-0">
      <div className="w-8 h-8 bg-white/[0.10] rounded-lg flex items-center justify-center text-text-tertiary flex-shrink-0">
        {icon}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-white text-sm font-medium">{title}</div>
        <div className="text-text-tertiary text-xs">{description}</div>
      </div>
      <div className="flex-shrink-0">{action}</div>
    </div>
  );
}

export function DangerRow({
  title,
  description,
  onAction,
}: {
  title: string;
  description: string;
  onAction: () => void;
}) {
  return (
    <div className="flex items-center justify-between py-3 border-b border-card-border/35">
      <div>
        <div className="text-white text-sm font-medium">{title}</div>
        <div className="text-text-tertiary text-xs">{description}</div>
      </div>
      <button
        onClick={onAction}
        className="px-3 py-1.5 border border-red-400/30 rounded-lg text-red-400 text-xs font-medium hover:bg-red-400/10 transition-colors"
      >
        <Trash2 className="w-3 h-3 inline mr-1" />
        Clear
      </button>
    </div>
  );
}
