import { Button as FluentButton, Spinner } from "@fluentui/react-components";
import * as React from "react";
import { cn } from "../../util/cn";

/**
 * The app-wide button. Backed by Fluent's Button so padding, radius, fill,
 * hover/pressed states, disabled treatment and the focus ring all come from the
 * Fluent theme; `variant`/`size` are kept as the old vocabulary so the ~150
 * existing call sites did not have to change.
 */
type ButtonVariant = "ghost" | "primary" | "secondary" | "outline" | "icon";
type ButtonSize = "sm" | "lg";

type ButtonProps = Omit<React.ComponentProps<"button">, "size"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
};

const APPEARANCE: Record<
  ButtonVariant,
  "primary" | "secondary" | "outline" | "subtle"
> = {
  primary: "primary",
  secondary: "secondary",
  outline: "outline",
  ghost: "subtle",
  icon: "subtle",
};

// "small" = 24px tall, "medium" = 32px — the heights the old h-6 / h-8 gave.
const FLUENT_SIZE: Record<ButtonSize, "small" | "medium"> = {
  sm: "small",
  lg: "medium",
};

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "lg",
      className,
      type = "submit",
      loading,
      children,
      ...props
    },
    ref
  ) => (
    <FluentButton
      ref={ref}
      type={type}
      appearance={APPEARANCE[variant]}
      size={FLUENT_SIZE[size]}
      shape={variant === "icon" ? "square" : "rounded"}
      icon={loading ? <Spinner size="tiny" /> : undefined}
      className={cn(variant === "icon" ? "px-0" : "my-1.5", className)}
      {...props}
    >
      {children}
    </FluentButton>
  )
);

Button.displayName = "Button";

export { Button };
