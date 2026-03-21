'use client';

import { cn } from '@/lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  width?: string;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, width = 'max-w-[580px]', footer, children }: ModalProps) {
  if (!isOpen) return null;

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 bg-surface-overlay backdrop-blur-sm z-[58] transition-opacity"
      />
      <div className={cn(
        'fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[calc(100%-2rem)]',
        width,
        'max-h-[85vh] bg-card border border-border rounded-2xl z-[59]',
        'flex flex-col overflow-hidden',
        'shadow-2xl',
      )}>
        {/* Header */}
        <div className="px-6 py-5 border-b border-border flex justify-between items-center shrink-0">
          <span className="text-xl font-bold text-foreground">{title}</span>
          <button
            onClick={onClose}
            className={cn(
              'size-8 rounded-xl flex items-center justify-center cursor-pointer',
              'bg-muted/50 text-muted-foreground hover:text-foreground hover:bg-muted',
              'transition-colors',
            )}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <path d="M18 6L6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {children}
        </div>

        {/* Footer */}
        {footer && (
          <div className="px-6 py-4 border-t border-border bg-muted/30 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </>
  );
}

export function FormField({ label, optional, children }: {
  label: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="mb-5">
      <label className="text-sm font-semibold text-foreground/70 block mb-1.5">
        {label}
        {optional && <span className="text-muted-foreground font-normal ml-1">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

export function OptionGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      {children}
    </div>
  );
}

export function OptionButton({ selected, onClick, children, title }: {
  selected: boolean;
  onClick: () => void;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'px-3.5 py-1.5 rounded-lg text-sm font-semibold cursor-pointer transition-all duration-150',
        selected
          ? 'bg-primary/15 border border-primary/30 text-primary'
          : 'bg-muted/50 border border-border/50 text-muted-foreground hover:text-foreground hover:border-border',
      )}
    >
      {children}
    </button>
  );
}

export function TextInput({ value, onChange, placeholder, mono, error, ...props }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  error?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  return (
    <input
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      className={cn(
        'w-full bg-muted/40 border rounded-xl px-3.5 py-2.5 text-[15px] text-foreground',
        'placeholder:text-muted-foreground/50',
        'focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50',
        'transition-all',
        mono && 'font-mono text-sm',
        error ? 'border-destructive' : 'border-border',
      )}
      {...props}
    />
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3 }: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
}) {
  return (
    <textarea
      value={value}
      onChange={e => onChange(e.target.value)}
      placeholder={placeholder}
      rows={rows}
      className={cn(
        'w-full bg-muted/40 border border-border rounded-xl px-3.5 py-2.5 text-sm text-foreground',
        'placeholder:text-muted-foreground/50 resize-vertical leading-relaxed',
        'focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50',
        'transition-all',
      )}
    />
  );
}

export function SelectInput({ value, onChange, options }: {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      className={cn(
        'w-full bg-muted/40 border border-border rounded-xl px-3.5 py-2.5 text-[15px] text-foreground',
        'focus:outline-none focus:ring-2 focus:ring-ring/30 focus:border-ring/50',
        'transition-all cursor-pointer',
      )}
    >
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
