import Dashboard from "@/components/Dashboard";

export const metadata = {
  title: 'Dashboard · Wind Power India',
  description: 'Live wind energy intelligence: capacity, auctions, tariffs, news, and bankability analytics for India wind projects.',
};

export default function DashboardPage() {
  return (
    <div className="flex flex-col min-h-screen lg:h-screen w-screen overflow-x-hidden lg:overflow-hidden bg-[#090d18]">
      <Dashboard />
    </div>
  );
}
