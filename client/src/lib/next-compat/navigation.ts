import {
  useLocation,
  useNavigate,
  useSearchParams as useRouterSearchParams,
} from "react-router-dom";

type RouteHref = string | URL;

interface NavigateOptions {
  scroll?: boolean;
}

function toRoute(href: RouteHref): string {
  return href instanceof URL
    ? `${href.pathname}${href.search}${href.hash}`
    : href;
}

export function useRouter() {
  const navigate = useNavigate();

  return {
    push(href: RouteHref, options?: NavigateOptions) {
      const preventScrollReset = options?.scroll === false;
      navigate(toRoute(href), {
        preventScrollReset,
        state: preventScrollReset ? { preventScrollReset } : undefined,
      });
    },
    replace(href: RouteHref, options?: NavigateOptions) {
      const preventScrollReset = options?.scroll === false;
      navigate(toRoute(href), {
        replace: true,
        preventScrollReset,
        state: preventScrollReset ? { preventScrollReset } : undefined,
      });
    },
    back() {
      navigate(-1);
    },
    forward() {
      navigate(1);
    },
    refresh() {
      window.location.reload();
    },
    prefetch() {
      return Promise.resolve();
    },
  };
}

export function usePathname() {
  return useLocation().pathname;
}

export function useSearchParams() {
  const [searchParams] = useRouterSearchParams();
  return searchParams;
}
