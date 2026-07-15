'use client';

import { useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: {
            client_id: string;
            scope: string;
            callback: (response: { access_token?: string; error?: string }) => void;
          }): { requestAccessToken(): void };
        };
      };
    };
  }
}

type Props = {
  onImported: (result: { importId: string; uploaded: number }) => void;
  onError: (message: string) => void;
};

export function GooglePhotosButton({ onImported, onError }: Props) {
  const [ready, setReady] = useState(() => typeof window !== 'undefined' && Boolean(window.google?.accounts?.oauth2));
  const [busy, setBusy] = useState(false);
  const popupRef = useRef<Window | null>(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  useEffect(() => {
    if (!clientId) return;
    if (window.google?.accounts?.oauth2) return;
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.onload = () => setReady(true);
    script.onerror = () => onError('Google sign-in could not be loaded.');
    document.head.appendChild(script);
    return () => script.remove();
  }, [clientId, onError]);

  const startPicker = () => {
    if (!clientId || !window.google) {
      onError('Add NEXT_PUBLIC_GOOGLE_CLIENT_ID to connect Google Photos.');
      return;
    }
    setBusy(true);
    popupRef.current = window.open('', 'google-photos-picker', 'width=520,height=760');
    const tokenClient = window.google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: 'https://www.googleapis.com/auth/photospicker.mediaitems.readonly',
      callback: async (tokenResponse) => {
        try {
          if (!tokenResponse.access_token) throw new Error(tokenResponse.error || 'Google authorization was cancelled.');
          const accessToken = tokenResponse.access_token;
          const sessionResponse = await fetch('/api/google-photos/session', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ googleAccessToken: accessToken, maxItemCount: 500 }),
          });
          const sessionJson = await sessionResponse.json();
          const session = sessionJson.data?.session;
          if (!sessionResponse.ok || !session?.id || !session?.pickerUri) throw new Error(sessionJson.error || 'Picker session failed.');
          if (popupRef.current) popupRef.current.location.href = `${session.pickerUri}/autoclose`;

          const started = Date.now();
          while (Date.now() - started < 10 * 60 * 1000) {
            await new Promise((resolve) => setTimeout(resolve, 2500));
            const check = await fetch(`/api/google-photos/session?sessionId=${encodeURIComponent(session.id)}`, {
              headers: { 'x-google-access-token': accessToken },
            });
            const checkJson = await check.json();
            if (checkJson.data?.session?.mediaItemsSet) break;
          }

          const imported = await fetch('/api/google-photos/import', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ googleAccessToken: accessToken, sessionId: session.id }),
          });
          const importedJson = await imported.json();
          if (!imported.ok) throw new Error(importedJson.error || 'Google Photos import failed.');
          onImported(importedJson.data);
        } catch (error: unknown) {
          popupRef.current?.close();
          onError(error instanceof Error ? error.message : 'Google Photos could not be connected.');
        } finally {
          setBusy(false);
        }
      },
    });
    tokenClient.requestAccessToken();
  };

  return (
    <button className="source-option" type="button" onClick={startPicker} disabled={!ready || busy || !clientId}>
      <span className="source-icon google-mark">G</span>
      <span><strong>Google Photos</strong><small>{clientId ? 'Choose outfit photos from your Pixel' : 'Add Google OAuth client ID'}</small></span>
      <span className="source-arrow">→</span>
    </button>
  );
}
