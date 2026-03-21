'use client';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  maxWidth?: number;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, maxWidth = 580, footer, children }: ModalProps) {
  if (!isOpen) return null;
  return (
    <>
      <div className="modal-overlay" onClick={onClose} />
      <div className="modal-container" style={{ maxWidth }}>
        <div className="modal-header">
          <span className="modal-title">{title}</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </>
  );
}

export function FormField({ label, optional, children }: { label: string; optional?: boolean; children: React.ReactNode }) {
  return (
    <div className="form-field">
      <label className="form-label">
        {label}
        {optional && <span className="form-label-optional">(optional)</span>}
      </label>
      {children}
    </div>
  );
}

export function OptionGroup({ children }: { children: React.ReactNode }) {
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>{children}</div>;
}

export function OptionButton({ selected, onClick, children, title }: {
  selected: boolean; onClick: () => void; children: React.ReactNode; title?: string;
}) {
  return (
    <button onClick={onClick} title={title}
      className={`option-btn ${selected ? 'option-btn--active' : ''}`}>
      {children}
    </button>
  );
}

export function TextInput({ value, onChange, placeholder, mono, error, ...props }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
  mono?: boolean; error?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  return (
    <input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      className={`form-input ${mono ? 'form-input--mono' : ''} ${error ? 'form-input--error' : ''}`}
      {...props} />
  );
}

export function TextArea({ value, onChange, placeholder, rows = 3 }: {
  value: string; onChange: (v: string) => void; placeholder?: string; rows?: number;
}) {
  return (
    <textarea value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
      rows={rows} className="form-textarea" />
  );
}

export function SelectInput({ value, onChange, options }: {
  value: string; onChange: (v: string) => void; options: { value: string; label: string }[];
}) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className="form-select">
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
