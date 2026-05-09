import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      name?:     string | null;
      email?:    string | null;
      image?:    string | null;
      id?:       string;
      googleId?: string;
      tier?:     'FREE' | 'PREMIUM';
    };
  }
}
