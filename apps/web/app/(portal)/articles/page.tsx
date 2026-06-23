import type { Metadata } from 'next';
import ArticlesReader from '@/components/Articles/ArticlesReader';

export const metadata: Metadata = {
  title: 'Articles · Windpower Directory',
  description:
    'Indian Windpower 2025 — An Overview of Windpower. Articles reproduced exactly as published, browsable by article or by writer.',
};

export default function ArticlesPage() {
  return <ArticlesReader />;
}
