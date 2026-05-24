import LoginForm from './LoginForm';

export const metadata = {
  title: 'Admin sign in — Wind Power India',
};

export const dynamic = 'force-dynamic';

export default function AdminLoginPage({
  searchParams,
}: {
  searchParams: { from?: string };
}) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#090d18] px-6 text-text">
      <div className="w-full max-w-sm">
        <h1 className="text-center text-2xl font-semibold">
          Wind Power India <span className="text-muted">admin</span>
        </h1>
        <p className="mt-2 text-center text-sm text-muted">
          Sign in to view analytics.
        </p>
        <LoginForm from={searchParams.from} />
      </div>
    </main>
  );
}
