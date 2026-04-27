import type { AnchorHTMLAttributes, ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";

type Url = string | URL;

interface LinkProps extends Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href"
> {
  href: Url;
  children?: ReactNode;
  prefetch?: boolean;
  replace?: boolean;
  scroll?: boolean;
}

function toHref(href: Url): string {
  return href instanceof URL ? href.toString() : href;
}

function isExternalHref(href: string): boolean {
  return /^[a-z][a-z\d+.-]*:/i.test(href);
}

export default function Link({
  href,
  children,
  prefetch: _prefetch,
  replace,
  scroll: _scroll,
  ...props
}: LinkProps) {
  const to = toHref(href);

  if (isExternalHref(to)) {
    return (
      <a href={to} {...props}>
        {children}
      </a>
    );
  }

  return (
    <RouterLink to={to} replace={replace} {...props}>
      {children}
    </RouterLink>
  );
}
