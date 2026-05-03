import { fetchWpiData } from "@/lib/api";
import TopBar from "@/components/TopBar";
import PortalShell from "@/components/PortalShell";

export const metadata = {
  title: 'Wind Power India — Geospatial Intelligence Portal',
  description: 'Live wind energy intelligence: capacity, auctions, tariffs, news, and bankability analytics for India wind projects.',
};

export default async function Home() {
  const bundle = await fetchWpiData();
  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#090d18]">
      <TopBar generatedAt={bundle?.generatedAt} />
      <PortalShell bundle={bundle} />
    </div>
  );
}
