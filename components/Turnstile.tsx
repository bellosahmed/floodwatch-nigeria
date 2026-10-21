"use client";

import { useEffect, useRef } from "react";

// The optional Cloudflare Turnstile bot check, shared by every public form that costs something to abuse.
// It renders nothing unless NEXT_PUBLIC_TURNSTILE_SITE_KEY is set. Tokens are single-use: bump `resetSignal` after
// each submit attempt to get a fresh challenge.

type TurnstileApi = {
  render: (el: HTMLElement, options: { sitekey: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }) => string;
  reset: (widgetId?: string) => void;
};
declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export default function Turnstile({ onToken, resetSignal }: { onToken: (token: string) => void; resetSignal: number }) {
  const box = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    const mount = () => {
      if (!window.turnstile || !box.current || widgetId.current) return;
      widgetId.current = window.turnstile.render(box.current, {
        sitekey: TURNSTILE_SITE_KEY,
        callback: onToken,
        "expired-callback": () => onToken(""),
        "error-callback": () => onToken(""),
      });
    };
    if (window.turnstile) return mount();
    const existing = document.querySelector<HTMLScriptElement>("script[data-turnstile]");
    if (existing) {
      existing.addEventListener("load", mount);
      return () => existing.removeEventListener("load", mount);
    }
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.async = true;
    script.dataset.turnstile = "1";
    script.onload = mount;
    document.head.appendChild(script);
  }, [onToken]);

  useEffect(() => {
    if (resetSignal > 0 && widgetId.current) {
      window.turnstile?.reset(widgetId.current);
      onToken("");
    }
  }, [resetSignal, onToken]);

  return TURNSTILE_SITE_KEY ? <div ref={box} style={{ marginTop: 12 }} /> : null;
}
