// Button — generated React wrapper for the design system.
// Thin wrapper: it emits the canonical CSS classes; the craft stays in the
// source stylesheet (code-as-source-of-truth). Requires the DS stylesheet at runtime.
// Bound source classes: hbtn, hbtn--acc, hbtn--sm, sq.

import { forwardRef, type ComponentPropsWithoutRef } from "react";

export type ButtonSize = "s";
export type ButtonVariant = "acc";

export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  size?: ButtonSize;
  variant?: ButtonVariant;
}

export const Button = forwardRef<HTMLElement, ButtonProps>(function Button(
  { size, variant, className, children, ...rest },
  ref,
) {
  const cls = [
    "hbtn",
    size === "s" && "hbtn--sm",
    variant === "acc" && "hbtn--acc",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button ref={ref as never} className={cls} {...rest}>
      <span className="sq" aria-hidden="true" />
      {children}
    </button>
  );
});

Button.displayName = "Button";

export default Button;
