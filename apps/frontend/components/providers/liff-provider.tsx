// SSOT Phase 001 §6.3 — LINE LIFF seamless provider
'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

interface LiffContextType {
  isReady: boolean;
  isLoggedIn: boolean;
  liffError: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: any | null;
}

const LiffContext = createContext<LiffContextType>({
  isReady: false,
  isLoggedIn: false,
  liffError: null,
  profile: null,
});

export const LiffProvider: React.FC<{ children: React.ReactNode; liffId: string }> = ({
  children,
  liffId,
}) => {
  const [isReady, setIsReady] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [profile, setProfile] = useState<any>(null);
  const [liffError, setLiffError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;

    const initLiff = async () => {
      try {
        if (!liffId) {
          if (isMounted) setIsReady(true);
          return;
        }
        const liff = (await import('@line/liff')).default;
        await liff.init({ liffId });

        if (isMounted) {
          setIsReady(true);
          if (liff.isLoggedIn()) {
            setIsLoggedIn(true);
            const userProfile = await liff.getProfile();
            setProfile(userProfile);
          }
        }
      } catch (err) {
        if (isMounted) {
          setLiffError(err instanceof Error ? err.message : 'LIFF Initialization Failed');
          setIsReady(true);
        }
      }
    };

    initLiff();

    return () => {
      isMounted = false;
    };
  }, [liffId]);

  return (
    <LiffContext.Provider value={{ isReady, isLoggedIn, liffError, profile }}>
      {children}
    </LiffContext.Provider>
  );
};

export const useLiff = () => useContext(LiffContext);
