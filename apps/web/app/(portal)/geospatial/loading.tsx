import GeospatialSkeleton from '@/components/skeletons/GeospatialSkeleton';

// Suspense fallback shown by Next.js while the /geospatial route chunk
// is loading on client-side navigation. The (portal) layout keeps the
// TopBar mounted, so this skeleton only fills the body area.
export default function Loading() {
  return <GeospatialSkeleton />;
}
