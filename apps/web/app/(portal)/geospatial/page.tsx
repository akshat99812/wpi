"use client";

import Dashboard from "@/components/Dashboard";
import { CeclBootScreen } from "@/components/CeclBootScreen";

export default function GeospatialPage() {
  return (
    <>
      <CeclBootScreen label="Intelligence Terminal Loading" />
      <Dashboard />
    </>
  );
}
