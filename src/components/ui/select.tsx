import { forwardRef, useId } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps
  extends Omit<React.SelectHTMLAttributes<HTMLSelectElement>, "size"> {
  label?: string;
  helperText?: string;
  error?: string;
  options?: SelectOption[];
  /** Placeholder shown as the first disabled option. */
  placeholder?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    label,
    helperText,
    error,
    options,
    placeholder,
    id,
    className,
    children,
    disabled,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const describedBy = error
    ? `${fieldId}-error`
    : helperText
      ? `${fieldId}-helper`
      : undefined;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={fieldId}
          className="mb-1.5 block text-sm font-medium text-text"
        >
          {label}
        </label>
      )}
      <div className="relative">
        <select
          ref={ref}
          id={fieldId}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn(
            "block w-full appearance-none rounded-md border bg-surface px-3 py-2 pr-9 text-sm text-text",
            "outline-none transition-colors",
            "border-border focus:border-accent focus:ring-2 focus:ring-accent/20",
            error && "border-danger focus:border-danger focus:ring-danger/20",
            disabled && "opacity-60 cursor-not-allowed",
            className,
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options
            ? options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled}>
                  {o.label}
                </option>
              ))
            : children}
        </select>
        <ChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted"
          aria-hidden
        />
      </div>
      {error ? (
        <p id={`${fieldId}-error`} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : helperText ? (
        <p id={`${fieldId}-helper`} className="mt-1.5 text-xs text-text-muted">
          {helperText}
        </p>
      ) : null}
    </div>
  );
});
