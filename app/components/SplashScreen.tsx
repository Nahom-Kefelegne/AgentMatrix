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
    // Fallback: hide splash after 20s regardless
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
            style={{
              position: 'fixed', inset: 0, zIndex: 9999,
              background: '#08080f',
              display: 'flex', flexDirection: 'column',
              alignItems: 'center', justifyContent: 'center',
              gap: 20,
            }}
          >
            <motion.div
              style={{ display: 'flex', alignItems: 'center', gap: 14 }}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
            >
              <motion.div
                animate={{
                  opacity: [0.3, 1, 0.3],
                  boxShadow: [
                    '0 0 4px rgba(81, 207, 102, 0.1)',
                    '0 0 24px rgba(81, 207, 102, 0.7), 0 0 8px rgba(81, 207, 102, 0.4)',
                    '0 0 4px rgba(81, 207, 102, 0.1)',
                  ],
                }}
                transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                style={{ width: 14, height: 14, borderRadius: '50%', background: '#51cf66' }}
              />
              <span style={{ fontSize: 28, fontWeight: 800, color: '#eee', letterSpacing: -0.5 }}>
                Agent Matrix
              </span>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              style={{ fontSize: 14, color: '#555', fontWeight: 500 }}
            >
              {ready ? 'Ready' : connected ? 'Initializing sessions...' : 'Connecting...'}
            </motion.div>

            {!ready && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                style={{ width: 200, height: 2, background: '#1a1a28', borderRadius: 1, overflow: 'hidden', marginTop: 4 }}
              >
                <motion.div
                  animate={{ x: ['-100%', '100%'] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: 'easeInOut' }}
                  style={{ width: '40%', height: '100%', background: 'linear-gradient(90deg, transparent, #4a9eff, transparent)' }}
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
