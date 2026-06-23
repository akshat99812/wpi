"use client";

/**
 * Articles section shell. Owns the single source of truth — which article is
 * open — and lays out the browse rail (by article / by writer) beside the
 * reader pane. Mirrors the responsive two-pane pattern used by the Research
 * page: the whole view scrolls on mobile, each pane scrolls independently on
 * large screens.
 */

import React, { useMemo, useState } from 'react';
import ArticleSidebar from './ArticleSidebar';
import ArticlePane from './ArticlePane';
import { ARTICLES, getArticleById, getWriterById } from './catalog';

export default function ArticlesReader() {
  const [selectedArticleId, setSelectedArticleId] = useState<string>(ARTICLES[0].id);

  const { article, writer } = useMemo(() => {
    const a = getArticleById(selectedArticleId) ?? ARTICLES[0];
    return { article: a, writer: getWriterById(a.writerId) };
  }, [selectedArticleId]);

  return (
    <main className="flex-1 grid grid-cols-1 lg:grid-cols-[340px_1fr] overflow-y-auto lg:overflow-hidden min-h-0">
      <section className="bg-[#0a0e18] border-b lg:border-b-0 lg:border-r border-[#1f2740] min-h-0 lg:h-full lg:overflow-hidden">
        <ArticleSidebar selectedArticleId={selectedArticleId} onSelect={setSelectedArticleId} />
      </section>
      <section className="bg-[#0c1120] min-h-0 lg:h-full lg:overflow-hidden">
        {writer ? (
          <ArticlePane article={article} writer={writer} />
        ) : (
          <div className="flex h-full items-center justify-center p-8 text-center text-sm text-white/50">
            This article could not be loaded.
          </div>
        )}
      </section>
    </main>
  );
}
