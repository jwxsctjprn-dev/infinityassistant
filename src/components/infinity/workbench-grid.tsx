"use client";

import { motion } from "framer-motion";

/**
 * Workbench mode background — a faint holographic "building table":
 * a perspective floor grid flowing toward the viewer, a soft horizon
 * glow, and a projection pad beneath the orb. Purely decorative.
 */
export function WorkbenchGrid() {
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.1, ease: "easeOut" }}
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
    >
      {/* horizon glow */}
      <div className="wb-horizon absolute inset-x-0 top-[14%] h-[36vh]" />

      {/* perspective floor grid */}
      <div className="absolute inset-x-[-60%] top-[24%] bottom-[-50%] [perspective:520px]">
        <div className="wb-floor absolute inset-0" />
      </div>

      {/* holographic pad under the orb */}
      <div className="absolute left-1/2 top-[46%] h-[190px] w-[420px] max-w-[92vw] -translate-x-1/2">
        <div className="wb-pad-rings absolute inset-0" />
        <div className="wb-pad-dial absolute inset-[16%]" />
      </div>
    </motion.div>
  );
}
