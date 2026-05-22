#!/usr/bin/env python3
"""
ingest_one.py — Phase-1 single-PDF ingestion for the wind RAG corpus.

Pipeline:
    parse (Docling -> markdown, cached)
        -> chunk (section-aware, 800-token windows, 100 overlap)
        -> embed (OpenAI text-embedding-3-small, 1536-dim, cosine)
        -> upsert (Qdrant collection wind_energy_v1)

Usage:
    python ingest_one.py <pdf_path> <year> [--dry-run]

`--dry-run` stops after chunking and writes the first 50 chunks to
data/parsed/<stem>.chunks.jsonl for manual inspection.

Config comes from `.env` (next to this file) via python-dotenv. The
script reads OPENAI_API_KEY / QDRANT_URL / QDRANT_API_KEY /
QDRANT_COLLECTION only when actually embedding or upserting, so a
dry-run works without any keys set.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sys
import uuid
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import List, Tuple

from dotenv import load_dotenv
from tenacity import retry, stop_after_attempt, wait_exponential
from tqdm import tqdm
import tiktoken

# Heavy modules (docling, openai, qdrant_client) are imported lazily
# inside the functions that use them — Docling pulls layout models on
# first import and we don't want to pay that cost for `--help`.

ROOT = Path(__file__).resolve().parent
PARSED_DIR = ROOT / "data" / "parsed"

CHUNK_MAX_TOKENS = 800
CHUNK_OVERLAP = 100
EMBED_BATCH = 64
UPSERT_BATCH = 256
EMBED_MODEL = "text-embedding-3-small"
EMBED_DIM = 1536


# ────────────────────────────────────────────────────────────────────────────
# Data model
# ────────────────────────────────────────────────────────────────────────────

@dataclass
class Chunk:
    chunk_id: str       # deterministic sha1 hex; used to derive Qdrant UUID
    text: str           # the prefixed chunk text (what gets embedded)
    year: int
    source_file: str    # PDF basename
    page_start: int     # -1 when Docling doesn't easily expose pages
    page_end: int
    section: str        # nearest heading at chunk start
    has_table: bool


# ────────────────────────────────────────────────────────────────────────────
# Env helpers
# ────────────────────────────────────────────────────────────────────────────

def require_env(name: str) -> str:
    val = os.environ.get(name)
    if not val:
        sys.exit(
            f"FATAL: env var '{name}' is not set.\n"
            f"       Copy ingestion/.env.example to ingestion/.env and fill it in."
        )
    return val


# ────────────────────────────────────────────────────────────────────────────
# Parse — Docling
# ────────────────────────────────────────────────────────────────────────────

def parse_pdf(pdf_path: Path, *, force: bool = False) -> str:
    """Run Docling on the PDF, return its markdown rendering. Cached under
    data/parsed/<stem>.md — repeat runs skip the (slow) parse step.

    OCR engine selection matters a lot for scanned directories:
      - The Docling default (RapidOCR) was tested on the 2025 directory
        and produced ~16 KB of text for 709 image-only pages — most pages
        came back empty.
      - We switch to Apple Vision (OcrMacOptions) which handles printed
        text and table-like layouts much better on macOS.
      - We also force accurate table structure recognition so member
        lists / state capacity tables come through as markdown tables
        instead of being silently dropped.
      - force_full_page_ocr=True is critical: by default Docling only
        OCRs pages with no extractable text layer. The directory's cover
        ads do have a text layer (they pass through fine) but the actual
        member-roster pages are image-only AND get skipped without this
        flag. Verified: without it, a 709-page scan produces ~26 KB of
        output instead of the megabytes we expect.
      - images_scale=2.0 renders pages at ~144 DPI before OCR, which is
        needed for small tabular text to be legible. 1.0 (72 DPI) loses
        capacity figures and contact details.
      - lang=['en-US'] only — the directory is English; the default also
        includes fr/de/es which slows OCR and worsens recognition.
    On non-mac platforms, fall through to Tesseract CLI (apt install
    tesseract-ocr beforehand); without that, the default engine is used.
    """
    import sys
    PARSED_DIR.mkdir(parents=True, exist_ok=True)
    cache = PARSED_DIR / f"{pdf_path.stem}.md"
    if cache.exists() and not force:
        print(f"[parse] cache hit -> {cache.relative_to(ROOT)}")
        return cache.read_text(encoding="utf-8")
    if force and cache.exists():
        print(f"[parse] --force-reparse: discarding cached {cache.relative_to(ROOT)}")

    print(f"[parse] Docling parsing {pdf_path.name} (slow; first run also "
          f"downloads layout models)")
    from docling.document_converter import DocumentConverter, PdfFormatOption  # heavy
    from docling.datamodel.base_models import InputFormat
    from docling.datamodel.pipeline_options import (
        PdfPipelineOptions, TableFormerMode,
        OcrMacOptions, TesseractCliOcrOptions,
    )

    if sys.platform == "darwin":
        ocr_options = OcrMacOptions(
            lang=["en-US"],
            force_full_page_ocr=True,
        )
        print("[parse] OCR engine: Apple Vision (force_full_page_ocr=True, en-US)")
    else:
        ocr_options = TesseractCliOcrOptions(force_full_page_ocr=True)
        print("[parse] OCR engine: Tesseract CLI (force_full_page_ocr=True)")

    pipeline_options = PdfPipelineOptions(
        do_ocr=True,
        ocr_options=ocr_options,
        do_table_structure=True,
        images_scale=2.0,
    )
    pipeline_options.table_structure_options.mode = TableFormerMode.ACCURATE

    converter = DocumentConverter(
        format_options={
            InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options),
        },
    )
    result = converter.convert(str(pdf_path))
    md = result.document.export_to_markdown()
    cache.write_text(md, encoding="utf-8")
    print(f"[parse] cached -> {cache.relative_to(ROOT)} ({len(md):,} chars)")
    return md


# ────────────────────────────────────────────────────────────────────────────
# Chunk — section-aware + token-bounded
# ────────────────────────────────────────────────────────────────────────────

HEADING_RE = re.compile(r"^(#{1,3})\s+(.+?)\s*$", re.MULTILINE)
TABLE_LINE_RE = re.compile(r"^\s*\|.*\|\s*$", re.MULTILINE)


_WORD_RE = re.compile(r"[A-Za-z]{3,}")
_NOISE_HEADINGS = {
    "note", "notes", "books", "cable", "hoses", "tower", "blade",
    "example", "examples", "contact", "contact us", "contacts",
}


def is_weak_heading(heading: str) -> bool:
    """Heading-quality filter for OCR'd marketing-heavy docs.

    Docling promotes any visually-bold line to an H1/H2/H3, which on
    member-directory PDFs sweeps up stat-card labels ('80 GW', 'Wind'),
    bullet glyphs ('·', '· ..'), and footnote markers ('Note:'). Those
    headings fragment chunks into useless one-liners and pollute the
    'Section:' prefix that gets embedded.

    A heading is weak if any of:
      - fewer than 6 chars after stripping
      - contains no 3+ char alphabetic word (pure punctuation/numerics)
      - matches a small blocklist of known boilerplate labels
    """
    stripped = heading.strip()
    if len(stripped) < 6:
        return True
    if not _WORD_RE.search(stripped):
        return True
    # Normalize for blocklist: lowercase, collapse internal whitespace,
    # drop trailing punctuation/whitespace (handles 'Note :' and 'Note  :').
    normalized = re.sub(r"\s+", " ", stripped.lower()).rstrip(":. ").strip()
    if normalized in _NOISE_HEADINGS:
        return True
    return False


def split_sections(md: str) -> List[Tuple[str, str]]:
    """Split markdown on H1/H2/H3 headings into (heading, body) pairs.
    Content before the first heading is filed under 'Document'.

    Weak headings (see is_weak_heading) are not used to start a new
    section — the heading line itself stays in the markdown body of the
    preceding strong-headed section, so OCR boilerplate doesn't
    fragment chunks.
    """
    sections: List[Tuple[str, str]] = []
    last_end = 0
    last_heading = "Document"
    for m in HEADING_RE.finditer(md):
        heading = m.group(2).strip()
        if is_weak_heading(heading):
            continue
        body = md[last_end:m.start()].strip()
        if body:
            sections.append((last_heading, body))
        last_heading = heading
        last_end = m.end()
    tail = md[last_end:].strip()
    if tail:
        sections.append((last_heading, tail))
    return sections


def token_chunk(text: str, enc, max_tokens: int, overlap: int) -> List[str]:
    """Split a body of text into token-bounded windows.

    Paragraph-aware: split on `\\n\\n` first and pack paragraphs into
    windows that don't exceed `max_tokens`. A single paragraph longer
    than `max_tokens` falls back to a raw token-window split.

    After paragraph packing, prepend the last `overlap` tokens of the
    previous chunk to the next one for retrieval continuity.
    """
    paragraphs = [p for p in text.split("\n\n") if p.strip()]
    chunks: List[str] = []
    current: List[str] = []
    current_tokens = 0

    def flush() -> None:
        nonlocal current, current_tokens
        if current:
            chunks.append("\n\n".join(current))
            current = []
            current_tokens = 0

    for p in paragraphs:
        p_tokens = len(enc.encode(p))
        if p_tokens > max_tokens:
            # Oversized paragraph — flush packed text, then window-split this one.
            flush()
            ids = enc.encode(p)
            step = max(1, max_tokens - overlap)
            i = 0
            while i < len(ids):
                window = ids[i:i + max_tokens]
                chunks.append(enc.decode(window))
                if i + max_tokens >= len(ids):
                    break
                i += step
            continue
        if current_tokens + p_tokens > max_tokens:
            flush()
        current.append(p)
        current_tokens += p_tokens
    flush()

    # Inject overlap between consecutive paragraph-packed chunks.
    if overlap > 0 and len(chunks) > 1:
        out: List[str] = [chunks[0]]
        for prev, cur in zip(chunks, chunks[1:]):
            prev_ids = enc.encode(prev)
            tail = enc.decode(prev_ids[-overlap:]) if len(prev_ids) > overlap else ""
            out.append(f"{tail}\n\n{cur}".strip() if tail else cur)
        chunks = out

    return chunks


def chunk_id_for(source_file: str, heading: str, content: str) -> str:
    """Deterministic sha1 over source + section + first 256 chars of content.
    Stable across re-parses as long as the leading content is unchanged."""
    h = hashlib.sha1()
    h.update(source_file.encode("utf-8"))
    h.update(b"\x00")
    h.update(heading.encode("utf-8"))
    h.update(b"\x00")
    h.update(content.strip()[:256].encode("utf-8"))
    return h.hexdigest()


def chunk_markdown(
    md: str,
    *,
    year: int,
    source_file: str,
    max_tokens: int = CHUNK_MAX_TOKENS,
    overlap: int = CHUNK_OVERLAP,
) -> List[Chunk]:
    enc = tiktoken.get_encoding("cl100k_base")
    out: List[Chunk] = []
    for heading, body in split_sections(md):
        for piece in token_chunk(body, enc, max_tokens, overlap):
            prefixed = f"Year: {year}. Section: {heading}.\n\n{piece}"
            out.append(Chunk(
                chunk_id=chunk_id_for(source_file, heading, piece),
                text=prefixed,
                year=year,
                source_file=source_file,
                page_start=-1,
                page_end=-1,
                section=heading,
                has_table=bool(TABLE_LINE_RE.search(piece)),
            ))
    return out


# ────────────────────────────────────────────────────────────────────────────
# Embed — OpenAI
# ────────────────────────────────────────────────────────────────────────────

def embed_chunks(chunks: List[Chunk], openai_api_key: str) -> List[List[float]]:
    from openai import OpenAI  # lazy
    client = OpenAI(api_key=openai_api_key)

    @retry(
        stop=stop_after_attempt(5),
        wait=wait_exponential(multiplier=1, min=2, max=30),
        reraise=True,
    )
    def call(batch_texts: List[str]) -> List[List[float]]:
        resp = client.embeddings.create(model=EMBED_MODEL, input=batch_texts)
        return [d.embedding for d in resp.data]

    vectors: List[List[float]] = []
    for i in tqdm(range(0, len(chunks), EMBED_BATCH), desc="embed", unit="batch"):
        batch = chunks[i:i + EMBED_BATCH]
        vectors.extend(call([c.text for c in batch]))
    return vectors


# ────────────────────────────────────────────────────────────────────────────
# Qdrant
# ────────────────────────────────────────────────────────────────────────────

def ensure_collection(qdrant, collection: str) -> None:
    from qdrant_client.http import models as rest  # lazy
    existing = {c.name for c in qdrant.get_collections().collections}
    if collection in existing:
        return
    print(f"[qdrant] creating collection '{collection}' (cosine, {EMBED_DIM}-d)")
    qdrant.create_collection(
        collection_name=collection,
        vectors_config=rest.VectorParams(size=EMBED_DIM, distance=rest.Distance.COSINE),
    )
    qdrant.create_payload_index(
        collection_name=collection,
        field_name="year",
        field_schema=rest.PayloadSchemaType.INTEGER,
    )
    qdrant.create_payload_index(
        collection_name=collection,
        field_name="source_file",
        field_schema=rest.PayloadSchemaType.KEYWORD,
    )


def upsert(qdrant, collection: str, chunks: List[Chunk], vectors: List[List[float]]) -> None:
    from qdrant_client.http import models as rest  # lazy
    for i in tqdm(range(0, len(chunks), UPSERT_BATCH), desc="upsert", unit="batch"):
        batch_c = chunks[i:i + UPSERT_BATCH]
        batch_v = vectors[i:i + UPSERT_BATCH]
        points = []
        for c, v in zip(batch_c, batch_v):
            # sha1 is 40 hex chars; UUID needs 32. The first 32 hex chars
            # are enough for a stable, well-distributed id.
            pid = str(uuid.UUID(c.chunk_id[:32]))
            points.append(rest.PointStruct(id=pid, vector=v, payload=asdict(c)))
        qdrant.upsert(collection_name=collection, points=points)


# ────────────────────────────────────────────────────────────────────────────
# Main
# ────────────────────────────────────────────────────────────────────────────

def main() -> None:
    ap = argparse.ArgumentParser(
        description="Phase-1 single-PDF ingestion for the wind RAG corpus.",
    )
    ap.add_argument("pdf", type=Path, help="Path to the source PDF.")
    ap.add_argument("year", type=int, help="Publication year (used as a payload field).")
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="Parse + chunk + write a .chunks.jsonl sample, then stop. "
             "Does NOT call OpenAI or Qdrant.",
    )
    ap.add_argument(
        "--force-reparse",
        action="store_true",
        help="Ignore any cached data/parsed/<stem>.md and re-run Docling. "
             "Use after changing OCR/pipeline options.",
    )
    args = ap.parse_args()

    load_dotenv(ROOT / ".env")

    if not args.pdf.exists():
        sys.exit(f"FATAL: PDF not found: {args.pdf}")

    # 1. Parse
    md = parse_pdf(args.pdf, force=args.force_reparse)

    # 2. Chunk
    chunks = chunk_markdown(md, year=args.year, source_file=args.pdf.name)
    print(f"[chunk] produced {len(chunks):,} chunks "
          f"({sum(c.has_table for c in chunks):,} flagged has_table)")

    # 3. Always dump the first 50 chunks for inspection
    sample_path = PARSED_DIR / f"{args.pdf.stem}.chunks.jsonl"
    with sample_path.open("w", encoding="utf-8") as f:
        for c in chunks[:50]:
            f.write(json.dumps(asdict(c), ensure_ascii=False) + "\n")
    print(f"[chunk] wrote first 50 -> {sample_path.relative_to(ROOT)}")

    if args.dry_run:
        print("[dry-run] stopping before embed/upsert.\n"
              "          Inspect the .chunks.jsonl, then re-run without --dry-run.")
        return

    # 4. Read env only when we'll actually call the APIs
    openai_key = require_env("OPENAI_API_KEY")
    qdrant_url = require_env("QDRANT_URL")
    qdrant_key = require_env("QDRANT_API_KEY")
    collection = require_env("QDRANT_COLLECTION")

    # 5. Embed
    vectors = embed_chunks(chunks, openai_key)

    # 6. Upsert
    from qdrant_client import QdrantClient  # lazy
    qdrant = QdrantClient(url=qdrant_url, api_key=qdrant_key)
    ensure_collection(qdrant, collection)
    upsert(qdrant, collection, chunks, vectors)

    print(f"[done] upserted {len(chunks):,} chunks into '{collection}' at {qdrant_url}")


if __name__ == "__main__":
    main()
