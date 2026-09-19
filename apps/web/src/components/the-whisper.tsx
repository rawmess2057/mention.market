"use client";

import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageCircle, X } from "lucide-react";
import { useSim } from "@/lib/sim";

interface WhisperMessage {
  id: string;
  text: string;
  icon?: string;
}

const WHISPER_POOL: WhisperMessage[] = [
  { id: "w1", text: "Whale alert: 500 shares bought on 'Inflation'", icon: "🐋" },
  { id: "w2", text: "Silence in the room... probability dropping", icon: "🤫" },
  { id: "w3", text: "Momentum shift: YES gaining 3% in 30 seconds", icon: "📈" },
  { id: "w4", text: "New trader joined: quant_queen bought NO", icon: "👤" },
  { id: "w5", text: "Volume spike detected on this market", icon: "📊" },
  { id: "w6", text: "The crowd is betting heavy on YES", icon: "🎯" },
  { id: "w7", text: "Market moving: implied probability just crossed 70%", icon: "⚡" },
  { id: "w8", text: "Someone just backed 'data center' with $300", icon: "💰" },
];

export function TheWhisper() {
  const [visible, setVisible] = useState(false);
  const [current, setCurrent] = useState<WhisperMessage | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const showRandom = useCallback(() => {
    const msg = WHISPER_POOL[Math.floor(Math.random() * WHISPER_POOL.length)];
    setCurrent(msg);
    setVisible(true);

    setTimeout(() => {
      setVisible(false);
      setTimeout(() => setCurrent(null), 400);
    }, 8000);
  }, []);

  useEffect(() => {
    if (dismissed) return;

    // Show first message after 3 seconds
    const initial = setTimeout(showRandom, 3000);

    // Then every 15-25 seconds
    const interval = setInterval(() => {
      if (Math.random() < 0.4) showRandom();
    }, 18000);

    return () => {
      clearTimeout(initial);
      clearInterval(interval);
    };
  }, [showRandom, dismissed]);

  return (
    <div className="fixed bottom-24 left-4 z-40 max-w-xs md:bottom-8 md:left-8">
      <AnimatePresence>
        {visible && current && (
          <motion.div
            initial={{ opacity: 0, y: 12, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.97 }}
            transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            className="rounded-2xl border border-gray-warm bg-white p-3 pr-8 shadow-dropdown"
          >
            <button
              onClick={() => {
                setVisible(false);
                setDismissed(true);
              }}
              className="absolute right-2 top-2 rounded-full p-0.5 text-gray-mid transition-colors hover:bg-cream-dark"
              aria-label="Dismiss"
            >
              <X className="h-3 w-3" />
            </button>
            <div className="flex items-start gap-2">
              <span className="mt-0.5 text-sm">{current.icon}</span>
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-blue">
                  The Whisper
                </div>
                <p className="mt-0.5 text-xs leading-relaxed text-navy">
                  {current.text}
                </p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Trigger button when hidden */}
      {!visible && !dismissed && (
        <motion.button
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          onClick={showRandom}
          className="flex h-10 w-10 items-center justify-center rounded-full border border-gray-warm bg-white text-gray-mid shadow-card transition-all hover:bg-cream-dark hover:text-blue hover:shadow-card-hover"
          aria-label="Show whisper"
        >
          <MessageCircle className="h-4 w-4" />
        </motion.button>
      )}
    </div>
  );
}
