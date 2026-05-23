export const metadata = {
  title: 'Analytics — Wind Power India',
};

export const dynamic = 'force-dynamic';

export default function AdminAnalyticsPage() {
  const shareUrl = process.env.UMAMI_SHARE_URL;

  if (!shareUrl) {
    return (
      <main className="min-h-screen bg-[#090d18] text-white">
        <div className="mx-auto max-w-2xl px-6 py-24">
          <h1 className="text-2xl font-semibold">Analytics</h1>
          <p className="mt-4 text-sm text-white/60">
            Set <code className="rounded bg-white/10 px-1.5 py-0.5">UMAMI_SHARE_URL</code>{' '}
            in the production environment to embed the Umami dashboard here. Create it
            in Umami at <em>Settings → Websites → Share URL → Enable</em>, then redeploy
            the web container.
          </p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-[#090d18]">
      <iframe
        src={shareUrl}
        title="Umami analytics"
        className="h-screen w-full border-0"
      />
    </main>
  );
}
