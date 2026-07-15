import AuthGate from '@/components/AuthGate';
import { WardrobeStudio } from '@/components/studio/WardrobeStudio';

export default function Home() {
  const configured = Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  );

  if (!configured) return <WardrobeStudio demoMode />;
  return <AuthGate><WardrobeStudio /></AuthGate>;
}
