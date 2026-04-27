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
      navigate(toRoute(href), {
        preventScrollReset: options?.scroll === false,
      });
    },
    replace(href: RouteHref, options?: NavigateOptions) {
      navigate(toRoute(href), {
        replace: true,
        preventScrollReset: options?.scroll === false,
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
