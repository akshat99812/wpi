import Dashboard from "@/components/Dashboard";

export const metadata = {
  title: 'Wind Power India — Geospatial Intelligence Portal',
  description: 'Live wind energy intelligence: capacity, auctions, tariffs, news, and bankability analytics for India wind projects.',
};

export default function Home() {
  return (
    <div className="flex flex-col min-h-screen lg:h-screen w-screen overflow-x-hidden lg:overflow-hidden bg-[#090d18]">
      <Dashboard />
    </div>
  );
}
