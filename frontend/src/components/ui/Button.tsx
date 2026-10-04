import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { buttonClass, type ButtonSize, type ButtonVariant } from './buttonClass';

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
}

export function Button({ variant = 'secondary', size = 'md', icon, className = '', children, type = 'button', ...rest }: Props) {
  return (
    <button type={type} className={buttonClass(variant, size, className)} {...rest}>
      {icon}
      {children}
    </button>
  );
}

interface LinkProps {
  to: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  icon?: ReactNode;
  className?: string;
  children: ReactNode;
  /** Open an external address in this tab (internal routes use the router). */
  external?: boolean;
}

export function ButtonLink({ to, variant = 'secondary', size = 'md', icon, className = '', children, external }: LinkProps) {
  const cls = buttonClass(variant, size, className);
  if (external || /^https?:\/\//.test(to) || to.startsWith('/auth/')) {
    return (
      <a href={to} className={cls}>
        {icon}
        {children}
      </a>
    );
  }
  return (
    <Link to={to} className={cls}>
      {icon}
      {children}
    </Link>
  );
}
