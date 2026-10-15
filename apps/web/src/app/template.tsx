"use client";

import { motion } from "framer-motion";
import { EASE } from "@/lib/motion";

/**
 * Every route fades in on navigation. Opacity only: a transform here would
 * make the page a containing block for the `position: fixed` trade bar and
 * sheet while the animation runs, and they would jump.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.26, ease: EASE }}>
      {children}
    </motion.div>
  );
}
