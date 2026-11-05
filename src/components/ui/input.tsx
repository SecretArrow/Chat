"use client";

import { forwardRef, useId, useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

/* -------------------------------------------------------------------------- */
/*  Input                                                                     */
/* -------------------------------------------------------------------------- */

export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size" | "prefix"> {
  label?: string;
  helperText?: string;
  error?: string;
  prefix?: React.ReactNode;
  suffix?: React.ReactNode;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  {
    label,
    helperText,
    error,
    prefix,
    suffix,
    id,
    className,
    disabled,
    ...props
  },
  ref,
) {
  const autoId = useId();
  const inputId = id ?? autoId;
  const describedBy = error
    ? `${inputId}-error`
    : helperText
      ? `${inputId}-helper`
      : undefined;

  return (
    <div className="w-full">
      {label && (
        <label
          htmlFor={inputId}
          className="mb-1.5 block text-sm font-medium text-text"
        >
          {label}
        </label>
      )}
      <div
        className={cn(
          "flex items-center rounded-md border bg-surface transition-colors",
          "border-border focus-within:border-accent focus-within:ring-2 focus-within:ring-accent/20",
          error && "border-danger focus-within:border-danger focus-within:ring-danger/20",
          disabled && "opacity-60",
        )}
      >
        {prefix && (
          <span className="pl-2.5 text-text-muted flex items-center">{prefix}</span>
        )}
        <input
          ref={ref}
          id={inputId}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn(
            "min-w-0 flex-1 bg-transparent px-3 py-2 text-sm text-text",
            "placeholder:text-text-faint outline-none",
            className,
          )}
          {...props}
        />
        {suffix && (
          <span className="pr-2.5 text-text-muted flex items-center">{suffix}</span>
        )}
      </div>
      {error ? (
        <p id={`${inputId}-error`} className="mt-1.5 text-xs text-danger">
          {error}
        </p>
      ) : helperText ? (
        <p id={`${inputId}-helper`} className="mt-1.5 text-xs text-text-muted">
          {helperText}
        </p>
      ) : null}
    </div>
  );
});

/* -------------------------------------------------------------------------- */
/*  Textarea                                                                  */
/* -------------------------------------------------------------------------- */

export interface TextareaProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  helperText?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, helperText, error, id, className, disabled, ...props },
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
        <textarea
          ref={ref}
          id={fieldId}
          aria-invalid={!!error}
          aria-describedby={describedBy}
          disabled={disabled}
          className={cn(
            "block w-full rounded-md border bg-surface px-3 py-2 text-sm text-text",
            "placeholder:text-text-faint outline-none transition-colors",
            "border-border focus:border-accent focus:ring-2 focus:ring-accent/20",
            error && "border-danger focus:border-danger focus:ring-danger/20",
            disabled && "opacity-60",
            className,
          )}
          {...props}
        />
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
  },
);

/* -------------------------------------------------------------------------- */
/*  PasswordInput                                                             */
/* -------------------------------------------------------------------------- */

export interface PasswordInputProps
  extends Omit<InputProps, "suffix" | "type"> {
  /** ARIA label for the show/hide toggle button. */
  toggleLabel?: string;
}

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  function PasswordInput({ toggleLabel = "Toggle password visibility", ...props }, ref) {
    const [shown, setShown] = useState(false);
    return (
      <Input
        ref={ref}
        type={shown ? "text" : "password"}
        suffix={
          <button
            type="button"
            aria-label={toggleLabel}
            onClick={() => setShown((s) => !s)}
            className="text-text-muted hover:text-text transition-colors p-0.5"
            tabIndex={-1}
          >
            {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        }
        {...props}
      />
    );
  },
);
