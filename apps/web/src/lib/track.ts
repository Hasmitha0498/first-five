/**
 * Privacy-conscious funnel tracking. Sends only allowlisted event names plus
 * UTM parameters; failures are ignored so the page never depends on tracking.
 */
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;
const STORE = "ff_utm";

export type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>;

/** Remember UTM parameters from the landing URL for this browser tab. */
export function captureUtm(search = window.location.search): void {
  const params = new URLSearchParams(search);
  const utm: Utm = {};
  for (const k of UTM_KEYS) {
    const v = params.get(k);
    if (v) utm[k] = v.slice(0, 100);
  }
  if (Object.keys(utm).length) {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(utm));
    } catch {
      /* storage unavailable */
    }
  }
}

export function getUtm(): Utm | undefined {
  try {
    const raw = sessionStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Utm) : undefined;
  } catch {
    return undefined;
  }
}

export type ClientEvent = "landing_page_viewed" | "paid_cta_clicked" | "waitlist_cta_clicked" | "access_page_viewed";

export function track(name: ClientEvent, placement?: string): void {
  try {
    void fetch("/api/events", {
      method: "POST",
      credentials: "same-origin",
      keepalive: true,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, placement, path: window.location.pathname, utm: getUtm() }),
    }).catch(() => undefined);
  } catch {
    /* never block the UI on tracking */
  }
}
