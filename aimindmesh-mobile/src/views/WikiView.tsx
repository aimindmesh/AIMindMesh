/**
 * WikiView.tsx
 * Mobile-first Neural Wiki explorer.
 * Two modes:
 *   - List mode: searchable, paginated catalog of wiki pages
 *   - Detail mode: full-screen Markdown renderer with [[Wikilink]] navigation
 *
 * Follows FeedView.tsx patterns for state management and empty states.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import ReactMarkdown from 'react-markdown';
import { Share } from '@capacitor/share';
import { AIMindMeshServerSettings } from '../types';
import { isDesktop, isMobile } from '../utils/platform';
import {
  WikiPage,
  WikiPageSummary,
  fetchWikiIndex,
  fetchWikiPage,
  triggerWikiCycle,
} from '../services/wikiService';

interface Props {
  serverSettings: AIMindMeshServerSettings | undefined;
}

// ─── Wikilink renderer ────────────────────────────────────────────────────────

function renderBody(
  body: string,
  allSlugs: Set<string>,
  onNavigate: (slug: string) => void
): React.ReactNode {
  // Replace [[Title]] with a custom marker before passing to ReactMarkdown
  // We render wikilinks as inline code nodes, then post-process
  const processed = body.replace(/\[\[([^\]]+)\]\]/g, (_match, title) => {
    const slug = title
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .trim()
      .replace(/\s+/g, '-');
    return `[[wikilink:${slug}:${title}]]`;
  });

  return (
    <ReactMarkdown
      components={{
        // @ts-ignore
        p({ children }) {
          // Parse wikilink markers inside paragraph text
          return <p className="text-sm text-text-secondary leading-relaxed mb-3">{processChildren(children, allSlugs, onNavigate)}</p>;
        },
        h1: ({ children }) => <h1 className="text-xl font-bold text-text-primary mb-3 mt-5">{children}</h1>,
        h2: ({ children }) => <h2 className="text-base font-bold text-primary mb-2 mt-4">{children}</h2>,
        h3: ({ children }) => <h3 className="text-sm font-semibold text-text-primary mb-1 mt-3">{children}</h3>,
        ul: ({ children }) => <ul className="list-disc list-inside mb-3 space-y-1">{children}</ul>,
        li: ({ children }) => <li className="text-sm text-text-secondary">{children}</li>,
        strong: ({ children }) => <strong className="text-text-primary font-semibold">{children}</strong>,
        em: ({ children }) => <em className="text-text-secondary/80">{children}</em>,
        code: ({ children }) => (
          <code className="bg-white/10 text-primary/90 text-xs px-1.5 py-0.5 rounded font-mono">{children}</code>
        ),
        blockquote: ({ children }) => (
          <blockquote className="border-l-2 border-primary/40 pl-3 italic text-text-secondary/70 my-3">{children}</blockquote>
        ),
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}

function processChildren(
  children: React.ReactNode,
  allSlugs: Set<string>,
  onNavigate: (slug: string) => void
): React.ReactNode {
  if (typeof children === 'string') {
    return parseWikilinks(children, allSlugs, onNavigate);
  }
  if (Array.isArray(children)) {
    return children.map((child, i) => (
      <React.Fragment key={i}>{processChildren(child, allSlugs, onNavigate)}</React.Fragment>
    ));
  }
  return children;
}

function parseWikilinks(
  text: string,
  allSlugs: Set<string>,
  onNavigate: (slug: string) => void
): React.ReactNode[] {
  const parts = text.split(/(\[\[wikilink:[^\]]+\]\])/g);
  return parts.map((part, i) => {
    const match = part.match(/\[\[wikilink:([^:]+):([^\]]+)\]\]/);
    if (!match) return <React.Fragment key={i}>{part}</React.Fragment>;
    const [, slug, title] = match;
    const exists = allSlugs.has(slug);
    return (
      <button
        key={i}
        onClick={() => exists && onNavigate(slug)}
        className={`inline font-medium transition-colors ${
          exists
            ? 'text-primary hover:text-primary/80 underline decoration-primary/40'
            : 'text-text-secondary/50 cursor-default'
        }`}
        disabled={!exists}
        title={exists ? `Open: ${title}` : `Page not yet compiled: ${title}`}
      >
        {title}
      </button>
    );
  });
}

// ─── WikiView ─────────────────────────────────────────────────────────────────

const WikiView: React.FC<Props> = ({ serverSettings }) => {
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [currentPage, setCurrentPage] = useState<WikiPage | null>(null);
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<'category' | 'folder' | 'az'>('category');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const serverConfigured = !!(serverSettings?.enabled && serverSettings?.serverUrl);

  const allSlugs = new Set(pages.map(p => p.slug));

  // ─── Load index ────────────────────────────────────────────────────────────

  const loadIndex = useCallback(async () => {
    if (!serverConfigured) return;
    setLoading(true);
    setError(null);
    try {
      const summaries = await fetchWikiIndex(serverSettings!);
      setPages(summaries);
    } catch (e: any) {
      setError(e?.message ?? 'Failed to load wiki');
    } finally {
      setLoading(false);
    }
  }, [serverConfigured, serverSettings]);

  useEffect(() => {
    if (serverConfigured) loadIndex();
  }, [serverConfigured, loadIndex]);

  // ─── Search ────────────────────────────────────────────────────────────────

  const filteredPages = searchQuery.trim()
    ? pages.filter(
        p =>
          p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
          p.tags.some(t => t.toLowerCase().includes(searchQuery.toLowerCase()))
      )
    : pages;

  const SYSTEM_TAGS = ['concept', 'chunk', 'topic', 'moc', 'system'];

  const groupedPages = useMemo(() => {
    if (groupBy === 'az') {
      return { 'All Pages': [...filteredPages].sort((a, b) => a.title.localeCompare(b.title)) };
    }

    const groups = filteredPages.reduce((acc, page) => {
      let groupKey = 'General';

      if (groupBy === 'category') {
        const semanticTag = page.tags.find(t => !SYSTEM_TAGS.includes(t.toLowerCase()));
        groupKey = semanticTag ? semanticTag : 'General';
      } else if (groupBy === 'folder') {
        groupKey = page.folder || 'concepts';
      }

      if (!acc[groupKey]) acc[groupKey] = [];
      acc[groupKey].push(page);
      return acc;
    }, {} as Record<string, typeof filteredPages>);

    // Sort keys and inner arrays
    const sortedGroups: Record<string, typeof filteredPages> = {};
    Object.keys(groups).sort().forEach(k => {
      sortedGroups[k] = groups[k].sort((a, b) => a.title.localeCompare(b.title));
    });
    return sortedGroups;
  }, [filteredPages, groupBy]);

  // ─── Navigation ────────────────────────────────────────────────────────────

  const openPage = useCallback(
    async (slug: string, pushHistory = true) => {
      setLoading(true);
      setError(null);
      try {
        const page = await fetchWikiPage(serverSettings!, slug);
        if (pushHistory && currentPage) {
          setNavHistory(prev => [...prev, currentPage.slug]);
        }
        setCurrentPage(page);
        scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
      } catch (e: any) {
        setError(`Could not load page: ${e.message}`);
      } finally {
        setLoading(false);
      }
    },
    [serverSettings, currentPage]
  );

  const goBack = useCallback(() => {
    const prev = navHistory[navHistory.length - 1];
    if (!prev) {
      setCurrentPage(null);
      return;
    }
    setNavHistory(h => h.slice(0, -1));
    openPage(prev, false);
  }, [navHistory, openPage]);

  const handleSync = useCallback(async () => {
    if (!serverConfigured) return;
    setSyncing(true);
    try {
      await triggerWikiCycle(serverSettings!);
      // Refresh index after a short delay to let server start the cycle
      setTimeout(loadIndex, 2000);
    } catch (e: any) {
      setError(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }, [serverConfigured, serverSettings, loadIndex]);

  const handleExport = useCallback(async () => {
    if (!currentPage) return;
    
    const content = `# ${currentPage.title}\n\n${currentPage.body}\n\n---\n*Exported from Neural Wiki on ${new Date().toLocaleDateString()}*`;
    const fileName = `${currentPage.slug}.md`;

    try {
      if (isDesktop()) {
        const { save } = await import('@tauri-apps/plugin-dialog');
        const { writeTextFile } = await import('@tauri-apps/plugin-fs');
        
        const filePath = await save({
          filters: [{ name: 'Markdown', extensions: ['md'] }],
          defaultPath: fileName
        });
        
        if (filePath) {
          await writeTextFile(filePath, content);
        }
      } else if (isMobile()) {
        await Share.share({
          title: currentPage.title,
          text: content,
          dialogTitle: 'Export Wiki Page'
        });
      }
    } catch (e: any) {
      setError(`Export failed: ${e.message}`);
    }
  }, [currentPage]);

  // ─── Empty States ──────────────────────────────────────────────────────────

  if (!serverConfigured) {
    return (
      <div className="flex flex-col items-center justify-center h-full px-8 text-center gap-4">
        <div className="text-5xl">📖</div>
        <h2 className="text-xl font-bold text-text-primary">Neural Wiki</h2>
        <p className="text-sm text-text-secondary leading-relaxed">
          Connect your AIMindMesh Server in Settings to access the compiled knowledge wiki.
        </p>
      </div>
    );
  }

  // ─── Detail View ───────────────────────────────────────────────────────────

  if (currentPage) {
    return (
      <div className="flex flex-col h-full bg-background">
        {/* Header */}
        <header className="px-4 pt-5 pb-3 flex items-center gap-3 border-b border-white/5 shrink-0 bg-surface/80 backdrop-blur-md">
          <button
            id="wiki-back-btn"
            onClick={goBack}
            className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors shrink-0"
            aria-label="Back"
          >
            <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-base font-bold text-text-primary truncate">{currentPage.title}</h1>
            {currentPage.tags.length > 0 && (
              <div className="flex gap-1 mt-0.5 flex-wrap">
                {currentPage.tags.map(t => (
                  <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-primary/10 text-primary/80 font-medium">
                    {t}
                  </span>
                ))}
              </div>
            )}
            {currentPage.sources && currentPage.sources.length > 0 && (
              <div className="flex gap-1 mt-1 flex-wrap">
                {currentPage.sources.map((s, i) => (
                  <span key={i} className="text-[9px] px-1.5 py-0.5 rounded-md bg-surface border border-white/5 text-text-secondary flex items-center gap-1">
                     <span className="capitalize opacity-60">{s.type}:</span>
                     <span className="truncate max-w-[80px] font-mono" title={s.id}>{s.id.slice(0,8)}…</span>
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleExport}
              className="p-2 rounded-xl bg-white/5 hover:bg-white/10 transition-colors"
              title="Export as Markdown"
            >
              <svg className="w-4 h-4 text-text-secondary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a2 2 0 002 2h12a2 2 0 002-2v-1M16 9l-4 4m0 0l-4-4m4 4V4" />
              </svg>
            </button>
            <span className="text-[10px] text-text-secondary/50">
              {currentPage.updatedAt.slice(0, 10)}
            </span>
          </div>
        </header>

        {/* Body */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 pb-8">
          {renderBody(currentPage.body, allSlugs, (slug) => openPage(slug))}
        </div>
      </div>
    );
  }

  // ─── List View ─────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col h-full bg-background relative">
      {/* Header */}
      <header className="px-5 pt-5 pb-3 shrink-0">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h1 className="text-2xl font-bold bg-gradient-to-r from-violet-400 to-purple-300 bg-clip-text text-transparent">
              Neural Wiki
            </h1>
            <p className="text-xs text-text-secondary mt-0.5">
              {pages.length} compiled pages
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              id="wiki-sync-btn"
              onClick={handleSync}
              disabled={syncing}
              className="p-2 rounded-xl bg-surface/80 border border-white/10 hover:border-primary/30 transition-all disabled:opacity-40"
              aria-label="Run synthesis cycle"
            >
              <svg
                className={`w-4 h-4 text-text-secondary ${syncing ? 'animate-spin' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </button>
          </div>
        </div>

        {/* Search */}
        <div className="relative mb-3">
          <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-secondary/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M17 11A6 6 0 1 1 5 11a6 6 0 0 1 12 0z" />
          </svg>
          <input
            id="wiki-search-input"
            type="search"
            placeholder="Search pages..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 rounded-xl bg-surface/60 border border-white/10 text-sm text-text-primary placeholder-text-secondary/40 focus:outline-none focus:border-primary/40 transition-colors"
          />
        </div>

        {/* Group By Toggle */}
        <div className="flex items-center gap-1 bg-surface/40 p-1 rounded-xl border border-white/5 w-full">
          <button
            onClick={() => setGroupBy('category')}
            className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-widest rounded-lg transition-all ${groupBy === 'category' ? 'bg-primary text-primary-foreground shadow-md' : 'text-text-secondary/60 hover:text-text-primary'}`}
          >
            Category
          </button>
          <button
            onClick={() => setGroupBy('folder')}
            className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-widest rounded-lg transition-all ${groupBy === 'folder' ? 'bg-primary text-primary-foreground shadow-md' : 'text-text-secondary/60 hover:text-text-primary'}`}
          >
            Folder
          </button>
          <button
            onClick={() => setGroupBy('az')}
            className={`flex-1 py-1.5 text-xs font-bold uppercase tracking-widest rounded-lg transition-all ${groupBy === 'az' ? 'bg-primary text-primary-foreground shadow-md' : 'text-text-secondary/60 hover:text-text-primary'}`}
          >
            A-Z
          </button>
        </div>
      </header>

      {/* Error */}
      {error && (
        <div className="mx-5 mb-3 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-xl text-sm text-red-400">
          {error}
        </div>
      )}

      {/* Page list */}
      <div className="flex-1 overflow-y-auto px-5 pb-8">
        {loading && pages.length === 0 ? (
          <div className="flex justify-center py-12">
            <div className="w-6 h-6 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
          </div>
        ) : filteredPages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center gap-4 py-16 opacity-60">
            <div className="text-5xl">📭</div>
            <p className="text-sm text-text-secondary">
              {searchQuery ? 'No pages match your search.' : 'No pages compiled yet. Tap ↻ to run the first synthesis.'}
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3 pt-1">
            {Object.entries(groupedPages).map(([folder, folderPages]) => (
              <div key={folder} className="mb-2">
                <div className="text-[10px] uppercase tracking-widest font-black text-text-secondary/50 mb-2 pl-2">
                  {folder}
                </div>
                <div className="flex flex-col gap-2">
                  {folderPages.map(page => (
                    <button
                      id={`wiki-page-${page.slug}`}
                      key={page.slug}
                      onClick={() => openPage(page.slug)}
                      className="w-full text-left rounded-2xl bg-surface/40 border border-white/5 p-4 hover:bg-surface/70 hover:border-primary/20 active:scale-[0.98] transition-all"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <h3 className="text-sm font-semibold text-text-primary leading-snug">{page.title}</h3>
                        <span className="text-[10px] text-text-secondary/40 shrink-0 mt-0.5">{page.updatedAt.slice(0, 10)}</span>
                      </div>
                      {page.tags.length > 0 && (
                        <div className="flex gap-1 mt-1.5 flex-wrap">
                          {page.tags.slice(0, 4).map(t => (
                            <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-full bg-white/5 text-text-secondary/60">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default WikiView;
