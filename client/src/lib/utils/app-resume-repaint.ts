import { isTauriMobile } from "@/lib/tauri";

export const activeResumeRepaintAttribute = "data-app-resume-repaint";
export const lastResumeRepaintTokenAttribute = "data-last-resume-repaint-token";
export const appResumeRepaintEvent = "ferrotune:app-resume-repaint";
export const nativeAppResumeEvent = "ferrotune:native-app-resume";

function createResumeRepaintToken(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function isAndroidTauriWebView(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") {
    return false;
  }

  return isTauriMobile() && /android|wv/i.test(navigator.userAgent);
}

/**
 * Forces a lightweight app-wide repaint so Android WebView resumes do not wait
 * for the next touch gesture before recompositing blurred layers.
 */
export function requestAppResumeRepaint(reason: string): string | null {
  if (typeof window === "undefined") {
    return null;
  }

  const html = document.documentElement;
  const body = document.body;

  if (!body) {
    return null;
  }

  const token = createResumeRepaintToken();

  html.dataset.lastResumeRepaintToken = token;
  html.setAttribute(activeResumeRepaintAttribute, token);

  // Force style/layout work immediately so the temporary repaint class is not
  // deferred until another user-driven interaction happens.
  void body.offsetHeight;

  window.dispatchEvent(
    new CustomEvent(appResumeRepaintEvent, {
      detail: { reason, token },
    }),
  );

  window.requestAnimationFrame(() => {
    window.dispatchEvent(new Event("resize"));

    window.requestAnimationFrame(() => {
      if (html.getAttribute(activeResumeRepaintAttribute) === token) {
        html.removeAttribute(activeResumeRepaintAttribute);
      }
    });
  });

  return token;
}
