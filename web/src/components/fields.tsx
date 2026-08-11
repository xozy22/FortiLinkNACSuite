// ---------------------------------------------------------------------------
// Formularfelder, die ihre Regeln aus dem CMDB-Schema ziehen.
// Laenge, erlaubte Optionen und Wertebereich stehen im Schema – nicht im Code.
// ---------------------------------------------------------------------------
import { useMemo, useState, type ReactNode } from 'react';
import { AlertTriangle, Check, ChevronDown, X } from 'lucide-react';
import type { SchemaField } from '@/api/types';
import { checkField, helpOf } from '@/lib/schema';

interface Base {
  label: string;
  field?: SchemaField;
  name: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
}

function Wrapper({
  label,
  required,
  hint,
  error,
  warn,
  children,
  help,
}: {
  label: string;
  required?: boolean;
  hint?: ReactNode;
  error?: string | null;
  warn?: string | null;
  children: ReactNode;
  help?: string;
}) {
  return (
    <div className="field">
      <label title={help}>
        {label}
        {required && <span className="req">*</span>}
      </label>
      {children}
      {error && (
        <div className="err">
          <AlertTriangle size={11} style={{ marginTop: 2, flex: 'none' }} />
          <span>{error}</span>
        </div>
      )}
      {!error && warn && (
        <div className="warn">
          <AlertTriangle size={11} style={{ marginTop: 2, flex: 'none' }} />
          <span>{warn}</span>
        </div>
      )}
      {!error && !warn && hint && <div className="hint">{hint}</div>}
    </div>
  );
}

// --- Text ------------------------------------------------------------------

export function TextField({
  label,
  field,
  name,
  value,
  onChange,
  placeholder,
  required,
  hint,
  error,
  mono,
  disabled,
}: Base & {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  mono?: boolean;
  disabled?: boolean;
}) {
  const issue = useMemo(() => checkField(field, value, name), [field, value, name]);
  const err = error ?? (issue?.level === 'error' ? issue.message : null);
  const warn = issue?.level === 'warn' ? issue.message : null;
  const max = field?.size;
  const over = !!(max && value.length > max);

  return (
    <Wrapper label={label} required={required} hint={hint} error={err} warn={warn} help={helpOf(field)}>
      <input
        className={`input ${mono ? 'mono' : ''} ${err ? 'invalid' : ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
      />
      {max && (value.length > max * 0.7 || over) && (
        <div className={over ? 'err' : 'hint'} style={{ textAlign: 'right' }}>
          {value.length} / {max}
        </div>
      )}
    </Wrapper>
  );
}

// --- Auswahl ---------------------------------------------------------------

export function SelectField({
  label,
  field,
  value,
  onChange,
  options,
  required,
  hint,
  error,
  emptyLabel = '— none —',
  allowEmpty = true,
  disabled,
}: Base & {
  value: string;
  onChange: (v: string) => void;
  options?: { value: string; label: string; hint?: string }[];
  emptyLabel?: string;
  allowEmpty?: boolean;
  disabled?: boolean;
}) {
  const opts = useMemo(() => {
    if (options) return options;
    return (field?.options ?? []).map((o) => ({ value: o.name, label: o.name, hint: o.help }));
  }, [options, field]);

  // Ein Wert, den es nicht mehr gibt, darf nicht stillschweigend verschwinden.
  const orphan = value && !opts.some((o) => o.value === value);

  return (
    <Wrapper
      label={label}
      required={required}
      hint={hint}
      error={error}
      warn={orphan ? `"${value}" is not in the current list — it may have been removed on the FortiGate.` : null}
      help={helpOf(field)}
    >
      <select className={`select ${error ? 'invalid' : ''}`} value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {allowEmpty && <option value="">{emptyLabel}</option>}
        {orphan && <option value={value}>{value} (missing)</option>}
        {opts.map((o) => (
          <option key={o.value} value={o.value} title={o.hint}>
            {o.label}
          </option>
        ))}
      </select>
    </Wrapper>
  );
}

// --- Kombifeld: Vorschlagsliste, aber freie Eingabe erlaubt -----------------

/**
 * Fuer Felder, deren Wert aus einer Datasource kommt, die wir aber nicht
 * zuverlaessig vollstaendig lesen koennen. Ein reines Select wuerde hier
 * blockieren, obwohl das Objekt auf der FortiGate existiert.
 */
export function ComboField({
  label,
  field,
  name,
  value,
  onChange,
  options,
  required,
  hint,
  error,
  placeholder,
  disabled,
}: Base & {
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label?: string; hint?: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  const listId = `combo-${name}`;
  const issue = useMemo(() => checkField(field, value, name), [field, value, name]);
  const err = error ?? (issue?.level === 'error' ? issue.message : null);
  const unknown = !!value && !options.some((o) => o.value === value);

  return (
    <Wrapper
      label={label}
      required={required}
      hint={hint}
      error={err}
      warn={unknown ? 'Not in the detected list — make sure this name exists on the FortiGate.' : null}
      help={helpOf(field)}
    >
      <input
        className={`input mono ${err ? 'invalid' : ''}`}
        list={listId}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        spellCheck={false}
      />
      <datalist id={listId}>
        {options.map((o) => (
          <option key={o.value} value={o.value} label={o.label ?? o.hint} />
        ))}
      </datalist>
    </Wrapper>
  );
}

// --- Option als Schalter ---------------------------------------------------

export function ToggleField({
  label,
  field,
  value,
  onChange,
  hint,
  onValue = 'enable',
  offValue = 'disable',
  disabled,
}: {
  label: string;
  field?: SchemaField;
  value: string | undefined;
  onChange: (v: string) => void;
  hint?: ReactNode;
  onValue?: string;
  offValue?: string;
  disabled?: boolean;
}) {
  const on = value === onValue;
  return (
    <div className="switch-row">
      <div style={{ minWidth: 0 }}>
        <div className="sm" style={{ fontWeight: 500 }}>
          {label}
        </div>
        {hint && <div className="hint">{hint}</div>}
        {!hint && field?.help && <div className="hint">{field.help}</div>}
      </div>
      <label className="check" style={{ flex: 'none' }}>
        <input type="checkbox" checked={on} onChange={(e) => onChange(e.target.checked ? onValue : offValue)} disabled={disabled} />
        <span className="xs">{on ? 'enabled' : 'disabled'}</span>
      </label>
    </div>
  );
}

// --- Zahl ------------------------------------------------------------------

export function NumberField({
  label,
  field,
  name,
  value,
  onChange,
  hint,
  error,
  disabled,
  suffix,
}: Base & { value: number | undefined; onChange: (v: number) => void; disabled?: boolean; suffix?: string }) {
  const issue = checkField(field, value, name);
  const err = error ?? (issue?.level === 'error' ? issue.message : null);
  const range =
    field?.['min-value'] !== undefined && field?.['max-value'] !== undefined
      ? `${field['min-value']}–${field['max-value']}${suffix ? ` ${suffix}` : ''}`
      : undefined;

  return (
    <Wrapper label={label} hint={hint ?? range} error={err} help={helpOf(field)}>
      <input
        className={`input mono ${err ? 'invalid' : ''}`}
        type="number"
        value={value ?? ''}
        min={field?.['min-value']}
        max={field?.['max-value']}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      />
    </Wrapper>
  );
}

// --- Mengenfeld (member table) ---------------------------------------------

export function MemberField({
  label,
  field,
  value,
  onChange,
  available,
  hint,
  memberKey,
  disabled,
  emptyMeaning,
}: {
  label: string;
  field?: SchemaField;
  value: { [k: string]: string }[];
  onChange: (v: { [k: string]: string }[]) => void;
  available: string[];
  hint?: ReactNode;
  memberKey: string;
  disabled?: boolean;
  emptyMeaning?: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = (value ?? []).map((e) => e[memberKey]).filter(Boolean);
  const free = available.filter((a) => !selected.includes(a));

  const set = (names: string[]) => onChange(names.map((n) => ({ [memberKey]: n })));

  return (
    <Wrapper label={label} hint={hint} help={helpOf(field)}>
      <div
        className="input"
        style={{ display: 'flex', flexWrap: 'wrap', gap: 4, minHeight: 32, alignItems: 'center', cursor: disabled ? 'default' : 'text' }}
        onClick={() => !disabled && setOpen(true)}
      >
        {selected.length === 0 && <span className="dim xs">{emptyMeaning ?? 'none'}</span>}
        {selected.map((n) => (
          <span className="tag" key={n}>
            {n}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  set(selected.filter((s) => s !== n));
                }}
                aria-label={`Remove ${n}`}
              >
                <X size={10} />
              </button>
            )}
          </span>
        ))}
        <div className="spacer" />
        {!disabled && <ChevronDown size={13} className="dim" />}
      </div>

      {open && !disabled && (
        <div style={{ position: 'relative' }}>
          <div className="facet-pop" style={{ position: 'absolute', top: 2, left: 0, right: 0 }}>
            {free.length === 0 && <div className="xs dim" style={{ padding: 6 }}>Nothing left to add</div>}
            {free.map((n) => (
              <div
                key={n}
                className="facet-opt"
                onClick={() => {
                  set([...selected, n]);
                }}
              >
                <span className="mono xs">{n}</span>
              </div>
            ))}
            <div style={{ borderTop: '1px solid var(--border-soft)', marginTop: 4, paddingTop: 4 }}>
              <button className="btn sm ghost" style={{ width: '100%' }} onClick={() => setOpen(false)}>
                <Check size={12} /> Done
              </button>
            </div>
          </div>
        </div>
      )}
    </Wrapper>
  );
}
