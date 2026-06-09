import * as React from "react";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline";
}

const variantClasses: Record<string, string> = {
  default:     "bg-primary/15 text-primary border-primary/30",
  secondary:   "bg-muted text-muted-foreground border-border",
  destructive: "bg-destructive/15 text-destructive border-destructive/30",
  outline:     "bg-transparent text-foreground border-border",
};

export function Badge({ className = "", variant = "default", children, ...props }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-mono border ${variantClasses[variant]} ${className}`}
      {...props}
    >
      {children}
    </span>
  );
}
