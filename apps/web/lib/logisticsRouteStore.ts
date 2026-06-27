// Tiny pub/sub bridge so the logistics planner — which renders inside a modal
// portalled to <body>, deep below the pro-map — can hand its computed routes to
// the pro-map for drawing, without prop-drilling through six layers.
//
// The planner publishes; the pro-map subscribes and renders a map layer. New
// subscribers immediately receive the current value (so a remount redraws).

import type { LogisticsRoutesPayload } from "@/lib/logistics";

type Payload = LogisticsRoutesPayload | null;
type Listener = (routes: Payload) => void;

let current: Payload = null;
const listeners = new Set<Listener>();

export function publishLogisticsRoutes(routes: Payload): void {
  current = routes;
  listeners.forEach((fn) => fn(routes));
}

export function subscribeLogisticsRoutes(fn: Listener): () => void {
  listeners.add(fn);
  fn(current); // replay current so a fresh subscriber is in sync
  return () => {
    listeners.delete(fn);
  };
}
