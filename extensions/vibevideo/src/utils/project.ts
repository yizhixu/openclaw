import path from "node:path";
import fs from "node:fs/promises";
import crypto from "node:crypto";

const DEFAULT_OUTPUT_ROOT = "~/vibevideo/output";

function expandHome(p: string): string {
  if (p.startsWith("~/") || p === "~") {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
    return path.join(home, p.slice(2));
  }
  return p;
}

export function generateVideoId(): string {
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  const rand = crypto.randomBytes(3).toString("hex");
  return `${ts}_${rand}`;
}

export function resolveOutputRoot(outputRoot?: string): string {
  const raw = outputRoot?.trim() || process.env.VIBEVIDEO_OUTPUT_ROOT || DEFAULT_OUTPUT_ROOT;
  return path.resolve(expandHome(raw));
}
