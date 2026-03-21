'use client';

import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useSocketContext } from './SocketProvider';

export default function SplashScreen({ children }: { children: React.ReactNode }) {
  const { socketRef, connected } = useSocketContext();
  const [ready, setReady] = useState(false);
  const [showSplash, setShowSplash] = useState(true);
  const readyRef = useRef(false);

  useEffect(() => {
    const fallback = setTimeout(() => {
      if (!readyRef.current) {
        readyRef.current = true;
        setReady(true);
        setTimeout(() => setShowSplash(false), 400);
      }
    }, 20000);
    return () => clearTimeout(fallback);
  }, []);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !connected) return;
    const handler = () => {
      if (readyRef.current) return;
      readyRef.current = true;
      setReady(true);
      setTimeout(() => setShowSplash(false), 800);
    };
    socket.on('app:ready' as any, handler);
    return () => { socket.off('app:ready' as any, handler); };
  }, [socketRef, connected]);

  return (
    <>
      <AnimatePresence>
        {showSplash && (
          <motion.div
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.02 }}
            transition={{ duration: 0.6, ease: 'easeInOut' }}
            className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center gap-5"
          >
            <motion.div
              className="flex items-center gap-3.5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <motion.div
                animate={{
                  opacity: [0.3, 1, 0.3],
                  boxShadow: [
                    '0 0 4px var(--status-working)',
                    '0 0 24px var(--status-working), 0 0 8px var(--status-working)',
                    '0 0 4px var(--status-working)',
                  ],
                }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                className="size-3.5 rounded-full bg-status-working"
              />
              <span className="text-[28px] font-extrabold text-foreground tracking-tight">
                Agent Matrix
              </span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="text-sm text-muted-foreground font-medium"
            >
              {ready ? 'Ready' : connected ? 'Initializing sessions...' : 'Connecting...'}
            </motion.div>

            {!ready && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="w-48 h-0.5 bg-muted rounded-full overflow-hidden mt-1"
              >
                <motion.div
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  className="w-2/5 h-full rounded-full bg-gradient-to-r from-transparent via-primary to-transparent"
                />
              </motion.div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
      {children}
    </>
  );
}
