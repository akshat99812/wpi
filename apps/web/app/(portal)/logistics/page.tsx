"use client";

import React from "react";
import LogisticsPlanner from "@/components/logistics/LogisticsPlanner";

/**
 * /logistics — Turbine Logistics Planner (Pro). Lives in the portal group so it
 * inherits the shared TopBar + bundle chrome (like /research/policy). The
 * planner component owns its own Pro gate and data loading.
 */
export default function LogisticsPage() {
  return <LogisticsPlanner />;
}
