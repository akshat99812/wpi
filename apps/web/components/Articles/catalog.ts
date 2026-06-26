/**
 * Articles catalog — "Indian Windpower 2025 — An Overview of Windpower…"
 *
 * The source directory has NO machine-readable text layer (the body is set
 * as vector outlines), so every article is reproduced from the ORIGINAL page
 * images (`/articles/pages/p-NN.webp`). That is the only way to preserve each
 * article exactly — signatures, author photographs and data tables included —
 * without risking a single transcription error.
 *
 * The metadata below (titles, authors, designations, page ranges) was verified
 * twice against high-resolution crops of each article's opening page. It drives
 * navigation only; the page images remain the authoritative content.
 *
 * Order: articles and writers are listed in the curated display order (not the
 * printed page sequence). `index` is the display position; `startPage`/`endPage`
 * still point at the correct page images regardless of order.
 */

export interface Article {
  /** Stable slug. */
  id: string;
  /** 1-based display position. */
  index: number;
  /** Main heading, exactly as printed. */
  title: string;
  /** Secondary heading line, when the original carries one. */
  subtitle?: string;
  /** Links to the authoring writer. */
  writerId: string;
  /** Author byline, exactly as printed (e.g. "Dr. J. Gururaja"). */
  authorName: string;
  /** Author designation block, exactly as printed. */
  designation: string;
  /** First page of the article (1-based, matches the page image number). */
  startPage: number;
  /** Last page of the article (inclusive). */
  endPage: number;
  /** Whether the opening page carries the author photograph. */
  hasPhoto: boolean;
  /** Whether the article contains at least one data table. */
  hasTable: boolean;
}

export interface Writer {
  id: string;
  /** Name, exactly as printed. */
  name: string;
  /** Designation, exactly as printed. */
  designation: string;
  /** Author headshot, or undefined when the directory prints none. */
  photo?: string;
  /** Slugs of every article this writer contributed. */
  articleIds: string[];
}

const AUTHORS = '/articles/authors';

/** Public path of a page image, 1-based. */
export const pagePath = (n: number): string =>
  `/articles/pages/p-${String(n).padStart(2, '0')}.webp`;

/** Inclusive list of page numbers spanned by an article. */
export const articlePages = (a: Article): number[] => {
  const out: number[] = [];
  for (let p = a.startPage; p <= a.endPage; p++) out.push(p);
  return out;
};

export const SECTION_TITLE = 'An Overview of Windpower…';
export const COLLECTION_TITLE = 'Indian Windpower 2025';

export const ARTICLES: Article[] = [
  {
    id: 'ministers-message',
    index: 1,
    title: 'Message',
    writerId: 'pralhad-joshi',
    authorName: 'Shri Pralhad Joshi',
    designation:
      'Minister of Consumer Affairs, Food & Public Distribution and Minister of New & Renewable Energy, Government of India',
    startPage: 78,
    endPage: 78,
    hasPhoto: true,
    hasTable: false,
  },
  {
    id: 'reflections-formative-stages',
    index: 2,
    title: "Reflections on Formative Stages of India's Windpower Development Programme",
    writerId: 'gururaja',
    authorName: 'Dr. J. Gururaja',
    designation: 'Former Adviser, DNES/MNRE',
    startPage: 1,
    endPage: 7,
    hasPhoto: true,
    hasTable: false,
  },
  {
    id: 'utilization-windpower-india',
    index: 3,
    title: 'Utilization of Windpower in India – Past & Future',
    writerId: 'dilip-nigam',
    authorName: 'Mr. Dilip Nigam',
    designation: 'Former Adviser, MNRE',
    startPage: 8,
    endPage: 13,
    hasPhoto: true,
    hasTable: false,
  },
  {
    id: 'strong-winds-bumpy-roads',
    index: 4,
    title: 'Strong Winds Blow Past Bumpy Roads',
    writerId: 'kasthurirangaian',
    authorName: 'Dr. K. Kasthurirangaian',
    designation: 'Chairman, Indian Wind Power Association',
    startPage: 14,
    endPage: 16,
    hasPhoto: true,
    hasTable: false,
  },
  {
    id: 'india-offshore-journey',
    index: 5,
    title: "India's Offshore Journey",
    writerId: 'rajesh-katyal',
    authorName: 'Dr. Rajesh Katyal',
    designation:
      'Director General, NIWE, Chennai, Under Ministry of New & Renewable Energy, Govt. of India',
    startPage: 37,
    endPage: 44,
    hasPhoto: true,
    hasTable: false,
  },
  {
    id: 'wind-sector-silently-led',
    index: 6,
    title: "Wind Sector has Silently led India's Energy Transition",
    writerId: 'dinesh-jagdale',
    authorName: 'Mr. Dinesh Dayanand Jagdale',
    designation:
      'President, Corporate Affairs & Retail Business at Suzlon Energy Ltd. & Former Joint Secretary to the Government of India',
    startPage: 75,
    endPage: 77,
    hasPhoto: true,
    hasTable: true,
  },
  {
    id: 'wind-solar-hybridization',
    index: 7,
    title: 'Wind Solar Hybridization - Some Considerations',
    writerId: 'mp-ramesh',
    authorName: 'Mr. M.P. Ramesh',
    designation: 'President, Vaayu Power Corp. & former Executive Director, NIWE',
    startPage: 45,
    endPage: 52,
    hasPhoto: true,
    hasTable: false,
  },
  {
    id: 'knowledge-bytes-grid-emission-factor',
    index: 8,
    title: 'Knowledge Bytes',
    subtitle: 'Q&A on Grid Emission Factor (EF)',
    writerId: 'nitin-raikar',
    authorName: 'Mr. Nitin Raikar',
    designation: 'Indian Wind Energy Veteran',
    startPage: 53,
    endPage: 55,
    hasPhoto: true,
    hasTable: false,
  },
  {
    id: 'windpower-development-overview',
    index: 9,
    title: 'Windpower Development in India - An Overview',
    writerId: 'ashesh-shrivastava',
    authorName: 'Mr. Ashesh Shrivastava',
    designation: 'Executive Director, CECL',
    startPage: 56,
    endPage: 66,
    hasPhoto: true,
    hasTable: true,
  },
  {
    id: 'windfarm-project-development',
    index: 10,
    title: 'Windfarm Project Development',
    writerId: 'sayan-deb',
    authorName: 'Mr. Sayan Deb',
    designation: 'Whole Time Director, Okaga Renewables',
    startPage: 17,
    endPage: 36,
    hasPhoto: true,
    hasTable: true,
  },
  {
    id: 'unlocking-efficiency-value-chain',
    index: 11,
    title: "Unlocking Efficiency Across India's Renewable Energy Value Chain",
    subtitle:
      'The Role of Digital Technological Solutions in Reducing Inefficiencies and Driving Sector-Wide Savings and Growth',
    writerId: 'sayan-deb',
    authorName: 'Mr. Sayan Deb',
    designation: 'Whole Time Director, Okaga Renewables',
    startPage: 67,
    endPage: 74,
    hasPhoto: false,
    hasTable: false,
  },
];

/**
 * Writers, in curated display order. `designation`/`photo` are the single
 * source of truth per author; `articleIds` is derived from ARTICLES so the
 * author→article mapping is never duplicated. Sayan Deb authored two articles
 * (Windfarm Project Development and Unlocking Efficiency) and is listed last;
 * every other writer authored one.
 */
const WRITER_BASE: Omit<Writer, 'articleIds'>[] = [
  {
    id: 'pralhad-joshi',
    name: 'Shri Pralhad Joshi',
    designation:
      'Minister of Consumer Affairs, Food & Public Distribution and Minister of New & Renewable Energy, Government of India',
    photo: `${AUTHORS}/pralhad-joshi.webp`,
  },
  {
    id: 'gururaja',
    name: 'Dr. J. Gururaja',
    designation: 'Former Adviser, DNES/MNRE',
    photo: `${AUTHORS}/gururaja.webp`,
  },
  {
    id: 'dilip-nigam',
    name: 'Mr. Dilip Nigam',
    designation: 'Former Adviser, MNRE',
    photo: `${AUTHORS}/dilip-nigam.webp`,
  },
  {
    id: 'kasthurirangaian',
    name: 'Dr. K. Kasthurirangaian',
    designation: 'Chairman, Indian Wind Power Association',
    photo: `${AUTHORS}/kasthurirangaian.webp`,
  },
  {
    id: 'rajesh-katyal',
    name: 'Dr. Rajesh Katyal',
    designation:
      'Director General, NIWE, Chennai, Under Ministry of New & Renewable Energy, Govt. of India',
    photo: `${AUTHORS}/rajesh-katyal.webp`,
  },
  {
    id: 'dinesh-jagdale',
    name: 'Mr. Dinesh Dayanand Jagdale',
    designation:
      'President, Corporate Affairs & Retail Business at Suzlon Energy Ltd. & Former Joint Secretary to the Government of India',
    photo: `${AUTHORS}/dinesh-jagdale.webp`,
  },
  {
    id: 'mp-ramesh',
    name: 'Mr. M.P. Ramesh',
    designation: 'President, Vaayu Power Corp. & former Executive Director, NIWE',
    photo: `${AUTHORS}/mp-ramesh.webp`,
  },
  {
    id: 'nitin-raikar',
    name: 'Mr. Nitin Raikar',
    designation: 'Indian Wind Energy Veteran',
    photo: `${AUTHORS}/nitin-raikar.webp`,
  },
  {
    id: 'ashesh-shrivastava',
    name: 'Mr. Ashesh Shrivastava',
    designation: 'Executive Director, CECL',
    photo: `${AUTHORS}/ashesh-shrivastava.webp`,
  },
  {
    id: 'sayan-deb',
    name: 'Mr. Sayan Deb',
    designation: 'Whole Time Director, Okaga Renewables',
    photo: `${AUTHORS}/sayan-deb.webp`,
  },
];

export const WRITERS: Writer[] = WRITER_BASE.map((w) => ({
  ...w,
  articleIds: ARTICLES.filter((a) => a.writerId === w.id).map((a) => a.id),
}));

export const getArticleById = (id: string): Article | undefined =>
  ARTICLES.find((a) => a.id === id);

export const getWriterById = (id: string): Writer | undefined =>
  WRITERS.find((w) => w.id === id);

export const getArticlesByWriter = (writerId: string): Article[] =>
  ARTICLES.filter((a) => a.writerId === writerId);
