import { redirect } from 'next/navigation';

export const metadata = {
  title: 'Wind Power India',
};

// Legacy route — the page moved to /geospatial. Preserve incoming links.
export default function DashboardLegacyRedirect() {
  redirect('/geospatial');
}
