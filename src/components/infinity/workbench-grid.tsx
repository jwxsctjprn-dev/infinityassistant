"use client";

import { motion } from "framer-motion";

/**
 * Workbench mode — the entire screen becomes a flat grid of faint blue
 * lines. Nothing else. It appears only after everything else has faded
 * to black (orchestrated by the page), and stays until the user exits.
 */
export function WorkbenchGrid() {
  return (
    <motion.div
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1, ease: "easeInOut" }}
      className="wb-grid pointer-events-none fixed inset-0 z-0"
    />
  );
}
