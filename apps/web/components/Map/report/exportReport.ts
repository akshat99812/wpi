"use client";

/**
 * Site-report export flow (plan §7.2): capture the three maps client-side, POST
 * the AOI geometry + images to the Pro-gated report endpoint, and download the
 * streamed PDF. Surfaces two phases ("capturing" then "rendering") so the UI can
 * tell the user which slow step is in flight — the capture is the janky one.
 */

import { captureMapImages } from "./mapCapture";

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3005";

export type ExportPhase = "idle" | "capturing" | "rendering" | "done" | "error";

export interface ExportReportArgs {
  /** Committed AOI outer ring (lon/lat), closed. */
  ring: [number, number][];
  onPhase?: (phase: ExportPhase) => void;
}

/** Pull the server filename out of Content-Disposition, with a safe fallback. */
function filenameFrom(res: Response): string {
  const cd = res.headers.get("Content-Disposition") || "";
  const match = cd.match(/filename="([^"]+)"/);
  return match?.[1] || "windpower-site-report.pdf";
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Run the full export. Throws on failure (the caller shows the message); the
 * `onPhase` callback drives the button's progress label. Never leaves the
 * endpoint a half-written PDF — a non-2xx response is read as JSON for its error.
 */
export async function exportReport(args: ExportReportArgs): Promise<void> {
  const { ring, onPhase } = args;

  onPhase?.("capturing");
  const mapImages = await captureMapImages({ ring });

  onPhase?.("rendering");
  const res = await fetch(`${API_URL}/api/site-analysis/report`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      geometry: { type: "Polygon", coordinates: [ring] },
      mapImages,
    }),
  });

  if (!res.ok) {
    let message = `Export failed (${res.status})`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON error body; keep the status message */
    }
    onPhase?.("error");
    throw new Error(message);
  }

  const blob = await res.blob();
  triggerDownload(blob, filenameFrom(res));
  onPhase?.("done");
}
