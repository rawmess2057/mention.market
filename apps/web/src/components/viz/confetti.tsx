"use client";

import { useEffect, useRef } from "react";

const COLORS = ["#2E7DF6", "#2B7550", "#C75B3A", "#F9F7F4", "#1A1A1A", "#EBF2FF"];

/** Fires a one-shot confetti burst when `fire` increments. Zero dependencies. */
export function Confetti({ fire }: { fire: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const lastFire = useRef(0);

  useEffect(() => {
    if (fire === lastFire.current || fire === 0) return;
    lastFire.current = fire;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const W = canvas.width;
    const originX = W / 2;
    const originY = canvas.height * 0.35;

    const parts = Array.from({ length: 140 }, () => {
      const angle = (Math.random() - 0.5) * Math.PI * 1.4;
      const speed = 6 + Math.random() * 9;
      return {
        x: originX,
        y: originY,
        vx: Math.cos(angle) * speed * (Math.random() > 0.5 ? 1 : -1),
        vy: Math.sin(angle) * speed - 4,
        w: 5 + Math.random() * 5,
        h: 3 + Math.random() * 4,
        rot: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        life: 1,
      };
    });

    let raf = 0;
    let frames = 0;
    const step = () => {
      frames++;
      ctx.clearRect(0, 0, W, canvas.height);
      let alive = false;
      for (const p of parts) {
        p.vy += 0.28;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        p.life -= 0.008;
        if (p.life > 0 && p.y < canvas.height + 20) {
          alive = true;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.globalAlpha = Math.max(0, p.life);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
          ctx.restore();
        }
      }
      if (alive && frames < 240) raf = requestAnimationFrame(step);
      else ctx.clearRect(0, 0, W, canvas.height);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [fire]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none fixed inset-0 z-[100]"
      aria-hidden
    />
  );
}
