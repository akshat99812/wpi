"use client";

/**
 * Reader pane. Shows a compact metadata header (title, byline, designation,
 * provenance badges) followed by the article reproduced from its ORIGINAL page
 * images. Rendering the published pages — rather than re-typed text — is what
 * guarantees signatures, photographs and tables appear exactly as printed.
 */

import React, { useEffect, useRef } from 'react';
import Image from 'next/image';
import { motion } from 'framer-motion';
import { articlePages, pagePath, SECTION_TITLE, type Article, type Writer } from './catalog';

const PAGE_W = 1240;
// Page images are cropped to remove the book's running header and footer, so
// only the article body remains. Keep this in sync with the crop height used
// when the assets are generated.
const PAGE_H = 1360;

interface Props {
  article: Article;
  writer: Writer;
}

function Header({ article, writer }: Props) {
  return (
    <div className="border-b border-[#1f2740] bg-[#0a0e18]/80 px-4 py-4 sm:px-6 sm:py-5">
      <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange/90">
        {SECTION_TITLE}
      </p>
      <h2 className="mt-1.5 text-[19px] font-extrabold leading-tight tracking-tight text-white sm:text-[22px]">
        {article.title}
      </h2>
      {article.subtitle && (
        <p className="mt-1 text-[12.5px] font-medium leading-snug text-white/55">
          {article.subtitle}
        </p>
      )}

      <div className="mt-3 flex items-center gap-3">
        {writer.photo && (
          <span className="relative h-10 w-10 flex-shrink-0 overflow-hidden rounded-full border border-[#2c3a5e] bg-[#1a2237]">
            <Image
              src={writer.photo}
              alt={article.authorName}
              fill
              sizes="40px"
              className="object-cover grayscale"
              unoptimized
            />
          </span>
        )}
        <span className="min-w-0">
          <span className="block text-[13px] font-bold text-white">{article.authorName}</span>
          <span className="block text-[11px] leading-snug text-white/50">
            {article.designation}
          </span>
        </span>
      </div>
    </div>
  );
}

export default function ArticlePane({ article, writer }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Jump back to the top whenever a different article is opened.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 });
  }, [article.id]);

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto custom-scrollbar">
      <Header article={article} writer={writer} />

      <motion.div
        key={article.id}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
        className="mx-auto w-full max-w-[900px] px-3 py-5 sm:px-6 sm:py-7"
      >
        {/* All pages stacked edge-to-edge inside one white sheet so the
            article reads as a single continuous page, not separate scans. */}
        <div className="overflow-hidden rounded-lg border border-[#1f2740] bg-white shadow-[0_8px_30px_-12px_rgba(0,0,0,0.8)]">
          {articlePages(article).map((pageNo, i) => (
            <Image
              key={pageNo}
              src={pagePath(pageNo)}
              alt={i === 0 ? article.title : ''}
              width={PAGE_W}
              height={PAGE_H}
              sizes="(max-width: 900px) 100vw, 900px"
              className="block h-auto w-full grayscale"
              priority={i === 0}
              unoptimized
            />
          ))}
        </div>

        <p className="mt-6 text-center text-[10.5px] leading-relaxed text-white/35">
          Reproduced exactly as published in the {SECTION_TITLE.replace(/…$/, '')} directory.
        </p>
      </motion.div>
    </div>
  );
}
