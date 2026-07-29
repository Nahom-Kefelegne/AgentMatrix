'use client';

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

type ModalVariant = 'dialog' | 'drawer';
const modalStack: symbol[] = [];
const inertRecords = new Map<HTMLElement, { count: number; original: boolean }>();

function acquireInert(element: HTMLElement): void {
  const record = inertRecords.get(element);
  if (record) {
    record.count += 1;
    return;
  }
  inertRecords.set(element, { count: 1, original: element.inert });
  element.inert = true;
}

function releaseInert(element: HTMLElement): void {
  const record = inertRecords.get(element);
  if (!record) return;
  record.count -= 1;
  if (record.count > 0) return;
  element.inert = record.original;
  inertRecords.delete(element);
}

interface FormFieldContextValue {
  controlId: string;
  labelId: string;
  descriptionId?: string;
}

const FormFieldContext = createContext<FormFieldContextValue | null>(null);

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  description?: ReactNode;
  icon?: ReactNode;
  maxWidth?: number;
  width?: number | string;
  variant?: ModalVariant;
  footer?: ReactNode;
  headerActions?: ReactNode;
  className?: string;
  bodyClassName?: string;
  bodyStyle?: CSSProperties;
  closeDisabled?: boolean;
  children: ReactNode;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function Modal({
  isOpen,
  onClose,
  title,
  eyebrow = 'Control Center',
  description,
  icon,
  maxWidth = 620,
  width,
  variant = 'dialog',
  footer,
  headerActions,
  className = '',
  bodyClassName = '',
  bodyStyle,
  closeDisabled = false,
  children,
}: ModalProps) {
  const [mounted, setMounted] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);
  const modalIdRef = useRef(Symbol('control-center-modal'));
  onCloseRef.current = onClose;
  closeDisabledRef.current = closeDisabled;
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isOpen || !mounted) return;
    const modalId = modalIdRef.current;
    modalStack.push(modalId);
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const inerted: HTMLElement[] = [];
    for (const child of Array.from(document.body.children)) {
      if (child === rootRef.current || !(child instanceof HTMLElement)) continue;
      inerted.push(child);
      acquireInert(child);
    }

    const frame = window.requestAnimationFrame(() => {
      const surface = surfaceRef.current;
      const preferred = surface?.querySelector<HTMLElement>('[data-autofocus]:not([disabled])');
      if (preferred) preferred.focus({ preventScroll: true });
      else surface?.focus({ preventScroll: true });
    });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (modalStack.at(-1) !== modalId) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        if (!closeDisabledRef.current) onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !surfaceRef.current) return;
      const focusable = Array.from(surfaceRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
      if (focusable.length === 0) {
        event.preventDefault();
        surfaceRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && (document.activeElement === first || document.activeElement === surfaceRef.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', handleKeyDown);
      const stackIndex = modalStack.lastIndexOf(modalId);
      if (stackIndex >= 0) modalStack.splice(stackIndex, 1);
      for (const element of inerted) releaseInert(element);
      window.requestAnimationFrame(() => previousFocus?.focus());
    };
  }, [isOpen, mounted]);

  if (!mounted || !isOpen) return null;

  return createPortal(
    <div ref={rootRef} className={`cc-modal-root cc-modal-root--${variant}`}>
      <button
        type="button"
        className="cc-modal-backdrop"
        onClick={() => {
          if (!closeDisabledRef.current) onCloseRef.current();
        }}
        aria-label={`Close ${title}`}
        tabIndex={-1}
        disabled={closeDisabled}
      />
      <div
        ref={surfaceRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={`cc-modal-surface cc-modal-surface--${variant} ${className}`}
        style={{
          '--cc-modal-max-width': `${maxWidth}px`,
          '--cc-modal-width': typeof width === 'number' ? `${width}px` : width,
        } as CSSProperties}
      >
        <div className="cc-modal-signal" aria-hidden="true" />
        <header className="cc-modal-header">
          <div className="cc-modal-heading">
            {icon ? <span className="cc-modal-icon" aria-hidden="true">{icon}</span> : null}
            <div className="cc-modal-heading-copy">
              <span className="cc-modal-eyebrow">{eyebrow}</span>
              <h2 id={titleId}>{title}</h2>
              {description ? <p id={descriptionId}>{description}</p> : null}
            </div>
          </div>
          <div className="cc-modal-header-actions">
            {headerActions}
            <button
              type="button"
              className="cc-modal-close"
              onClick={() => onCloseRef.current()}
              aria-label={`Close ${title}`}
              disabled={closeDisabled}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>
        </header>
        <div className={`cc-modal-body ${bodyClassName}`} style={bodyStyle}>{children}</div>
        {footer ? <footer className="cc-modal-footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

export function FormField({
  label,
  description,
  optional,
  required,
  children,
}: {
  label: string;
  description?: ReactNode;
  optional?: boolean;
  required?: boolean;
  children: ReactNode;
}) {
  const controlId = useId();
  const labelId = useId();
  const descriptionId = useId();
  return (
    <div className="form-field">
      <div className="form-label-row">
        <label className="form-label" id={labelId} htmlFor={controlId}>
          {label}
          {optional ? <span className="form-label-optional">Optional</span> : null}
          {required ? <span className="form-label-required" title="Required">*</span> : null}
        </label>
        {description ? <span className="form-description" id={descriptionId}>{description}</span> : null}
      </div>
      <FormFieldContext.Provider value={{
        controlId,
        labelId,
        descriptionId: description ? descriptionId : undefined,
      }}>
        {children}
      </FormFieldContext.Provider>
    </div>
  );
}

export function OptionGroup({ children }: { children: ReactNode }) {
  const field = useContext(FormFieldContext);
  return (
    <div
      id={field?.controlId}
      className="option-group"
      role="group"
      aria-labelledby={field?.labelId}
      aria-describedby={field?.descriptionId}
    >
      {children}
    </div>
  );
}

export function OptionButton({
  selected,
  onClick,
  children,
  title,
  description,
  disabled = false,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  title?: string;
  description?: ReactNode;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      aria-pressed={selected}
      className={`option-btn ${selected ? 'option-btn--active' : ''}`}
    >
      <span className="option-btn-title">{children}</span>
      {description ? <span className="option-btn-description">{description}</span> : null}
    </button>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  mono,
  error,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  error?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange'>) {
  const field = useContext(FormFieldContext);
  return (
    <input
      {...props}
      id={props.id ?? field?.controlId}
      aria-labelledby={props['aria-labelledby'] ?? field?.labelId}
      aria-describedby={props['aria-describedby'] ?? field?.descriptionId}
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      aria-invalid={error || undefined}
      className={`form-input ${mono ? 'form-input--mono' : ''} ${error ? 'form-input--error' : ''}`}
    />
  );
}

export function TextArea({
  value,
  onChange,
  placeholder,
  rows = 3,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  rows?: number;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange'>) {
  const field = useContext(FormFieldContext);
  return (
    <textarea
      {...props}
      id={props.id ?? field?.controlId}
      aria-labelledby={props['aria-labelledby'] ?? field?.labelId}
      aria-describedby={props['aria-describedby'] ?? field?.descriptionId}
      value={value}
      onChange={event => onChange(event.target.value)}
      placeholder={placeholder}
      rows={rows}
      className="form-textarea"
    />
  );
}

export function SelectInput({
  value,
  onChange,
  options,
  ...props
}: {
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
} & Omit<React.SelectHTMLAttributes<HTMLSelectElement>, 'onChange'>) {
  const field = useContext(FormFieldContext);
  return (
    <select
      {...props}
      id={props.id ?? field?.controlId}
      aria-labelledby={props['aria-labelledby'] ?? field?.labelId}
      aria-describedby={props['aria-describedby'] ?? field?.descriptionId}
      value={value}
      onChange={event => onChange(event.target.value)}
      className="form-select"
    >
      {options.map(option => (
        <option key={option.value} value={option.value}>{option.label}</option>
      ))}
    </select>
  );
}

export function useFormFieldControl() {
  return useContext(FormFieldContext);
}
