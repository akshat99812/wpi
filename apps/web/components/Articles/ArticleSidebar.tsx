"use client";

/**
 * Left rail for the Articles section. Lists every writer; each writer card
 * nests the article(s) they contributed as clickable rows, so the whole
 * directory is reachable by author. Selecting a row opens that article in the
 * reader pane. Writers with more than one article (Sayan Deb) show each piece
 * as its own row.
 */

import React from 'react';
import Image from 'next/image';
import {
  ARTICLES,
  WRITERS,
  COLLECTION_TITLE,
  SECTION_TITLE,
  getArticlesByWriter,
  type Writer,
} from './catalog';

interface Props {
  selectedArticleId: string;
  onSelect: (articleId: string) => void;
}

function WriterCard({
  writer,
  selectedArticleId,
  onSelect,
}: {
  writer: Writer;
  selectedArticleId: string;
  onSelect: (id: string) => void;
}) {
  const articles = getArticlesByWriter(writer.id);
  const ownsSelected = articles.some((a) => a.id === selectedArticleId);
  return (
    <div
      className={`rounded-xl border px-3 py-3 transition-colors duration-200
                  ${ownsSelected ? 'border-orange/50 bg-orange/[0.06]' : 'border-[#1f2740] bg-[#0c1120]'}`}
    >
      <div className="flex items-center gap-3">
        <span className="relative h-11 w-11 flex-shrink-0 overflow-hidden rounded-full border border-[#2c3a5e] bg-[#1a2237]">
          {writer.photo ? (
            <Image
              src={writer.photo}
              alt={writer.name}
              fill
              sizes="44px"
              className="object-cover"
              unoptimized
            />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-[13px] font-bold text-white/50">
              {writer.name.replace(/^(Dr\.|Mr\.|Ms\.|Mrs\.)\s*/, '').charAt(0)}
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[12.5px] font-bold text-white">{writer.name}</span>
          <span className="block text-[10.5px] leading-snug text-white/45 line-clamp-2">
            {writer.designation}
          </span>
        </span>
      </div>

      <div className="mt-2.5 space-y-1.5 border-t border-[#1f2740] pt-2.5">
        {articles.map((a) => {
          const isActive = a.id === selectedArticleId;
          return (
            <button
              key={a.id}
              type="button"
              onClick={() => onSelect(a.id)}
              aria-current={isActive ? 'true' : undefined}
              className={`flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors duration-200
                          ${
                            isActive
                              ? 'bg-orange/15 text-white'
                              : 'text-white/65 hover:bg-[#101730] hover:text-white'
                          }`}
            >
              <span
                className={`mt-px text-[10px] font-bold ${isActive ? 'text-orange' : 'text-white/35'}`}
              >
                {String(a.index).padStart(2, '0')}
              </span>
              <span className="text-[11.5px] font-medium leading-snug">{a.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function ArticleSidebar({ selectedArticleId, onSelect }: Props) {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex-shrink-0 border-b border-[#1f2740] px-4 pb-3 pt-4">
        <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-orange/90">
          {SECTION_TITLE}
        </p>
        <h1 className="mt-1 text-[17px] font-extrabold tracking-tight text-white">
          {COLLECTION_TITLE}
        </h1>
        <p className="mt-0.5 text-[11px] text-white/45">
          {WRITERS.length} writers · {ARTICLES.length} articles
        </p>
      </div>

      {/* Writers */}
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar px-3 py-3">
        <div className="space-y-2">
          {WRITERS.map((w) => (
            <WriterCard
              key={w.id}
              writer={w}
              selectedArticleId={selectedArticleId}
              onSelect={onSelect}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
