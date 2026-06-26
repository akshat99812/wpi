"use client";

import React from 'react';
import PolicyComparison from '@/components/policy/PolicyComparison';

/**
 * Research → Policy tab. Wind Policy Comparison (Pro) — pivot table of Indian
 * wind-energy policy across jurisdictions. The sidebar (in the research layout)
 * switches between this, Intelligence, and Chatbot.
 */
export default function ResearchPolicyPage() {
  return <PolicyComparison />;
}
