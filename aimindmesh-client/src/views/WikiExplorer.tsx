/**
 * WikiExplorer.tsx
 * Premium Neural Wiki explorer for the PC Client.
 *
 * Layout: 3-column (sidebar · content · right panel)
 *   - Left sidebar: searchable page list, sorted by date, with tags
 *   - Center: Markdown renderer with clickable [[Wikilinks]] and nav history
 *   - Right panel: page metadata, regenerate/delete actions
 *
 * NOTE: Uses a zero-dependency inline Markdown renderer to avoid adding
 *       react-markdown to the PC client bundle.
 */

import { useState, useEffect, useCallback, useRef, ReactNode, useMemo } from 'react';
import { BookOpen, Search, RotateCcw, Sparkles, ChevronLeft, ChevronRight, Tag, Clock, Link2, Zap, Trash2, Download } from 'lucide-react';
import { wikiApi, WikiPage, WikiPageSummary } from '../services/wikiApi';
import { Logger } from '../utils/logger';

// ─── Minimal inline Markdown renderer ────────────────────────────────────────

function toSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-').replace(/-+/g, '-').slice(0, 80);
}

/** Render a single line of inline text, converting **bold**, *em*, `code`, and [[links]] */
function renderInline(text: string, allSlugs: Set<string>, onNavigate: (s: string) => void, key?: number): ReactNode {
  const parts: ReactNode[] = [];
  // Combined regex for all inline tokens
  const re = /(\*\*([^*]+)\*\*)|(\*([^*]+)\*)|(`([^`]+)`)|\[\[([^\]]+)\]\]/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(<span key={`t-${key}-${i++}`}>{text.slice(lastIndex, match.index)}</span>);
    }
    if (match[1]) { // **bold**
      parts.push(<strong key={`b-${key}-${i++}`} className="font-bold text-foreground">{match[2]}</strong>);
    } else if (match[3]) { // *em*
      parts.push(<em key={`e-${key}-${i++}`} className="italic text-muted-foreground/80">{match[4]}</em>);
    } else if (match[5]) { // `code`
      parts.push(<code key={`c-${key}-${i++}`} className="bg-surface border border-border/50 text-primary/90 text-xs px-1.5 py-0.5 rounded font-mono">{match[6]}</code>);
    } else if (match[7]) { // [[wikilink]]
      const title = match[7];
      const slug = toSlug(title);
      const exists = allSlugs.has(slug);
      parts.push(
        <button
          key={`wl-${key}-${i++}`}
          onClick={() => exists && onNavigate(slug)}
          disabled={!exists}
          title={exists ? `Open: ${title}` : `Not compiled yet: ${title}`}
          className={`font-medium transition-colors rounded px-0.5 ${exists ? 'text-primary hover:text-primary-hover hover:underline cursor-pointer' : 'text-muted-foreground/50 cursor-default line-through'}`}
        >{title}</button>
      );
    }
    lastIndex = re.lastIndex;
  }
  if (lastIndex < text.length) parts.push(<span key={`t-${key}-${i++}`}>{text.slice(lastIndex)}</span>);
  return parts.length === 1 ? parts[0] : <>{parts}</>;
}

/** Parse a Markdown body string into React nodes */
function renderMarkdown(body: string, allSlugs: Set<string>, onNavigate: (s: string) => void): ReactNode[] {
  const lines = body.split('\n');
  const nodes: ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Headings
    if (line.startsWith('### ')) {
      nodes.push(<h3 key={i} className="text-base font-semibold text-foreground mb-2 mt-4">{line.slice(4)}</h3>);
    } else if (line.startsWith('## ')) {
      nodes.push(<h2 key={i} className="text-lg font-bold text-primary mb-3 mt-6">{line.slice(3)}</h2>);
    } else if (line.startsWith('# ')) {
      nodes.push(<h1 key={i} className="text-2xl font-black tracking-tight text-foreground mb-4 mt-8 pb-2 border-b border-border">{line.slice(2)}</h1>);
    }
    // Blockquote
    else if (line.startsWith('> ')) {
      nodes.push(
        <blockquote key={i} className="border-l-2 border-primary/40 pl-4 italic text-muted-foreground/70 my-4">
          {renderInline(line.slice(2), allSlugs, onNavigate, i)}
        </blockquote>
      );
    }
    // Code block
    else if (line.startsWith('```')) {
      const blockLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) {
        blockLines.push(lines[i]);
        i++;
      }
      nodes.push(
        <code key={i} className="block bg-surface border border-border rounded-xl px-4 py-3 text-xs font-mono text-primary/90 my-4 overflow-x-auto custom-scrollbar whitespace-pre">
          {blockLines.join('\n')}
        </code>
      );
    }
    // Unordered list
    else if (line.match(/^[-*] /)) {
      const items: ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^[-*] /)) {
        items.push(<li key={i} className="leading-relaxed">{renderInline(lines[i].slice(2), allSlugs, onNavigate, i)}</li>);
        i++;
      }
      nodes.push(<ul key={`ul-${i}`} className="list-disc list-inside space-y-1.5 mb-4 text-sm text-muted-foreground">{items}</ul>);
      continue;
    }
    // Ordered list
    else if (line.match(/^\d+\. /)) {
      const items: ReactNode[] = [];
      while (i < lines.length && lines[i].match(/^\d+\. /)) {
        const text = lines[i].replace(/^\d+\. /, '');
        items.push(<li key={i} className="leading-relaxed">{renderInline(text, allSlugs, onNavigate, i)}</li>);
        i++;
      }
      nodes.push(<ol key={`ol-${i}`} className="list-decimal list-inside space-y-1.5 mb-4 text-sm text-muted-foreground">{items}</ol>);
      continue;
    }
    // Horizontal rule
    else if (line.match(/^---+$/)) {
      nodes.push(<hr key={i} className="border-border my-4" />);
    }
    // Empty line → skip
    else if (line.trim() === '') {
      // no-op
    }
    // Paragraph
    else {
      nodes.push(
        <p key={i} className="text-sm text-muted-foreground leading-relaxed mb-4">
          {renderInline(line, allSlugs, onNavigate, i)}
        </p>
      );
    }
    i++;
  }
  return nodes;
}

// ─── WikiExplorer ─────────────────────────────────────────────────────────────

export default function WikiExplorer() {
  const [pages, setPages] = useState<WikiPageSummary[]>([]);
  const [currentPage, setCurrentPage] = useState<WikiPage | null>(null);
  const [navHistory, setNavHistory] = useState<string[]>([]);
  const [navFuture, setNavFuture] = useState<string[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupBy, setGroupBy] = useState<'category' | 'folder' | 'az'>('category');
  const [isLoadingIndex, setIsLoadingIndex] = useState(true);
  const [isLoadingPage, setIsLoadingPage] = useState(false);

  const [isRegenerating, setIsRegenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const allSlugs = new Set(pages.map(p => p.slug));

  // ─── Data loading ─────────────────────────────────────────────────────────

  const loadIndex = useCallback(async () => {
    setIsLoadingIndex(true);
    setError(null);
    try {
      const res = await wikiApi.listPages();
      setPages(res.data.pages ?? []);
    } catch (e: any) {
      setError(`Failed to load wiki index: ${e.message}`);
      Logger.error('WikiExplorer', e.message);
    } finally {
      setIsLoadingIndex(false);
    }
  }, []);

  useEffect(() => { loadIndex(); }, [loadIndex]);

  const openPage = useCallback(async (slug: string, pushHistory = true) => {
    setIsLoadingPage(true);
    setError(null);
    try {
      const res = await wikiApi.getPage(slug);
      if (pushHistory && currentPage) {
        setNavHistory(h => [...h, currentPage.slug]);
        setNavFuture([]);
      }
      setCurrentPage(res.data.page);
      contentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (e: any) {
      setError(`Page not found: ${slug}`);
    } finally {
      setIsLoadingPage(false);
    }
  }, [currentPage]);

  const goBack = useCallback(() => {
    const prev = navHistory[navHistory.length - 1];
    if (!prev) return;
    setNavFuture(f => currentPage ? [currentPage.slug, ...f] : f);
    setNavHistory(h => h.slice(0, -1));
    openPage(prev, false);
  }, [navHistory, currentPage, openPage]);

  const goForward = useCallback(() => {
    const next = navFuture[0];
    if (!next) return;
    setNavHistory(h => currentPage ? [...h, currentPage.slug] : h);
    setNavFuture(f => f.slice(1));
    openPage(next, false);
  }, [navFuture, currentPage, openPage]);



  const handleRegenerate = useCallback(async () => {
    if (!currentPage?.slug) return;
    setIsRegenerating(true);
    try {
      await wikiApi.regeneratePage(currentPage.slug);
      setTimeout(() => openPage(currentPage.slug, false), 4000);
    } catch (e: any) {
      setError(`Regenerate failed: ${e.message}`);
    } finally {
      setIsRegenerating(false);
    }
  }, [currentPage, openPage]);

  const handleExport = useCallback(async () => {
    if (!currentPage) return;
    setIsExporting(true);
    
    const content = `# ${currentPage.title}\n\n${currentPage.body}\n\n---\n*Exported from Neural Wiki on ${new Date().toLocaleDateString()}*`;
    const fileName = `${currentPage.slug}.md`;

    try {
      const { save } = await import('@tauri-apps/plugin-dialog');
      const { writeTextFile } = await import('@tauri-apps/plugin-fs');
      
      const filePath = await save({
        filters: [{ name: 'Markdown', extensions: ['md'] }],
        defaultPath: fileName
      });
      
      if (filePath) {
        await writeTextFile(filePath, content);
      }
    } catch (e: any) {
      setError(`Export failed: ${e.message}`);
      Logger.error('WikiExplorer', `Export failed: ${e.message}`);
    } finally {
      setIsExporting(false);
    }
  }, [currentPage]);

  const handleDelete = useCallback(async (slug: string) => {
    try {
      await wikiApi.deletePage(slug);
      if (currentPage?.slug === slug) setCurrentPage(null);
      loadIndex();
    } catch (e: any) {
      setError(`Delete failed: ${e.message}`);
    }
  }, [currentPage, loadIndex]);

  // ─── Filtered list ────────────────────────────────────────────────────────

  const filteredPages = searchQuery.trim()
    ? pages.filter(p =>
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

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="h-full flex flex-col bg-background animate-fade-in">
      {/* ── Top bar ───────────────────────────────────────────────────────── */}
      <div className="shrink-0 flex items-center gap-4 px-6 py-4 border-b border-border bg-background/98 z-10">
        <div className="flex items-center gap-3">
          <BookOpen className="w-6 h-6 text-primary" />
          <h1 className="text-xl font-black tracking-tight italic text-foreground">
            Neural Wiki
          </h1>
          <span className="text-xs text-muted-foreground font-mono bg-surface border border-border px-2 py-0.5 rounded-lg">
            {pages.length} pages
          </span>
        </div>

        <div className="flex items-center gap-2 ml-2">
          <button
            onClick={goBack}
            disabled={navHistory.length === 0}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors disabled:opacity-30"
            title="Back"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={goForward}
            disabled={navFuture.length === 0}
            className="p-1.5 rounded-lg hover:bg-surface-hover transition-colors disabled:opacity-30"
            title="Forward"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1" />

        {error && (
          <span className="text-xs text-error bg-error/10 border border-error/20 px-3 py-1.5 rounded-xl truncate max-w-xs">
            {error}
          </span>
        )}



        <button
          onClick={loadIndex}
          disabled={isLoadingIndex}
          className="p-2 rounded-xl hover:bg-surface-hover transition-colors disabled:opacity-40"
          title="Refresh index"
        >
          <RotateCcw className={`w-4 h-4 text-muted-foreground ${isLoadingIndex ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* ── Main columns ──────────────────────────────────────────────────── */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar — page list */}
        <aside className="w-72 shrink-0 border-r border-border flex flex-col bg-surface/30 overflow-hidden">
          {/* Search & Filters */}
          <div className="p-3 border-b border-border flex flex-col gap-3">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground/50" />
              <input
                id="wiki-search"
                type="search"
                placeholder="Search pages…"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-input border border-border text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 transition-colors"
              />
            </div>
            <div className="flex bg-surface rounded-lg p-0.5 border border-border">
              {(['category', 'folder', 'az'] as const).map(mode => (
                <button
                  key={mode}
                  onClick={() => setGroupBy(mode)}
                  className={`flex-1 text-[10px] font-bold py-1.5 rounded-md capitalize transition-all ${
                    groupBy === mode 
                      ? 'bg-background shadow-sm text-foreground' 
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {mode === 'az' ? 'A-Z' : mode}
                </button>
              ))}
            </div>
          </div>

          {/* Page list */}
          <div className="flex-1 overflow-y-auto custom-scrollbar py-2">
            {isLoadingIndex ? (
              <div className="flex items-center justify-center py-16">
                <Sparkles className="w-5 h-5 text-primary animate-pulse" />
              </div>
            ) : filteredPages.length === 0 ? (
              <div className="text-center py-12 px-4 text-muted-foreground/50 text-xs">
                {searchQuery ? 'No pages match.' : 'No pages compiled yet.\nClick "Run Cycle" to start.'}
              </div>
            ) : (
              Object.entries(groupedPages).map(([folder, folderPages]) => (
                <div key={folder} className="mb-4">
                  <div className="px-4 py-1.5 text-[10px] font-black uppercase tracking-widest text-muted-foreground/50 sticky top-0 bg-surface/90 backdrop-blur z-10 border-y border-border/50 shadow-sm mb-1">
                    {folder}
                  </div>
                  {folderPages.map(page => (
                    <button
                      id={`wiki-list-${page.slug}`}
                      key={page.slug}
                      onClick={() => openPage(page.slug)}
                      className={`w-full text-left px-4 py-3 rounded-xl mx-1.5 transition-all group ${
                        currentPage?.slug === page.slug
                          ? 'bg-primary/10 text-primary border border-primary/20'
                          : 'hover:bg-surface-hover text-muted-foreground hover:text-foreground border border-transparent'
                      }`}
                      style={{ width: 'calc(100% - 12px)' }}
                    >
                      <div className="text-xs font-semibold leading-snug truncate">{page.title}</div>
                      {page.tags.length > 0 && (
                        <div className="flex gap-1 mt-1 flex-wrap">
                          {page.tags.slice(0, 3).map(t => (
                            <span key={t} className="text-[9px] px-1.5 py-0.5 rounded-md bg-surface border border-border text-muted-foreground/60">
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="text-[9px] text-muted-foreground/40 mt-1">{page.updatedAt.slice(0, 10)}</div>
                    </button>
                  ))}
                </div>
              ))
            )}
          </div>
        </aside>

        {/* Center — Markdown content */}
        <main ref={contentRef} className="flex-1 overflow-y-auto custom-scrollbar px-10 py-8">
          {!currentPage ? (
            <div className="flex flex-col items-center justify-center h-full text-center gap-6 opacity-50">
              <BookOpen className="w-16 h-16 text-primary/30" />
              <div>
                <p className="text-lg font-bold text-foreground">Select a page</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Choose a page from the sidebar, or run a synthesis cycle to generate your first wiki pages.
                </p>
              </div>
            </div>
          ) : isLoadingPage ? (
            <div className="flex items-center justify-center h-full">
              <Sparkles className="w-6 h-6 text-primary animate-pulse" />
            </div>
          ) : (
            <article className="max-w-3xl mx-auto">
              <header className="mb-8">
                <h1 className="text-3xl font-black tracking-tight text-foreground">{currentPage.title}</h1>
                <div className="flex items-center gap-3 mt-2 flex-wrap">
                  {currentPage.tags.map(t => (
                    <span key={t} className="flex items-center gap-1 text-[10px] px-2 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary font-semibold">
                      <Tag className="w-2.5 h-2.5" />{t}
                    </span>
                  ))}
                  <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                    <Clock className="w-2.5 h-2.5" />{currentPage.updatedAt.slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
              </header>

              <div className="wiki-body">
                {renderMarkdown(currentPage.body, allSlugs, slug => openPage(slug))}
              </div>
            </article>
          )}
        </main>

        {/* Right panel — metadata */}
        {currentPage && (
          <aside className="w-56 shrink-0 border-l border-border flex flex-col bg-surface/20 p-4 gap-5 overflow-y-auto custom-scrollbar">
            {/* Actions */}
            <div className="flex flex-col gap-2">
              <p className="text-[9px] uppercase tracking-widest font-black text-muted-foreground/50 mb-1">Actions</p>
              <button
                id={`wiki-regen-${currentPage.slug}`}
                onClick={handleRegenerate}
                disabled={isRegenerating}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-surface border border-border hover:border-primary/30 hover:text-primary transition-all disabled:opacity-40"
              >
                <Zap className={`w-3 h-3 ${isRegenerating ? 'animate-pulse text-primary' : ''}`} />
                {isRegenerating ? 'Queued…' : 'Regenerate'}
              </button>
              <button
                id={`wiki-export-${currentPage.slug}`}
                onClick={handleExport}
                disabled={isExporting}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-surface border border-border hover:border-primary/30 hover:text-primary transition-all disabled:opacity-40"
              >
                <Download className={`w-3 h-3 ${isExporting ? 'animate-spin' : ''}`} />
                {isExporting ? 'Exporting…' : 'Export .md'}
              </button>
              <button
                onClick={() => handleDelete(currentPage.slug)}
                className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-bold bg-surface border border-border hover:border-error/30 hover:text-error transition-all"
              >
                <Trash2 className="w-3 h-3" />
                Delete page
              </button>
            </div>

            {/* Metadata */}
            <div className="flex flex-col gap-2">
              <p className="text-[9px] uppercase tracking-widest font-black text-muted-foreground/50 mb-1">Metadata</p>
              <div className="text-xs text-muted-foreground space-y-1.5">
                <div><span className="font-semibold text-foreground/60">Slug:</span><br />{currentPage.slug}</div>
                {currentPage.folder && <div><span className="font-semibold text-foreground/60">Folder:</span> {currentPage.folder}</div>}
                {currentPage.neo4jId && (
                  <div className="flex items-start gap-1">
                    <Link2 className="w-3 h-3 mt-0.5 shrink-0 text-primary/60" />
                    <span className="font-mono text-[9px] break-all text-muted-foreground/60">{currentPage.neo4jId.slice(0, 12)}…</span>
                  </div>
                )}
                <div><span className="font-semibold text-foreground/60">Updated:</span><br />{currentPage.updatedAt.slice(0, 10)}</div>
                <div><span className="font-semibold text-foreground/60">Words:</span> ~{currentPage.body.split(/\s+/).length}</div>
              </div>
            </div>

            {/* Sources */}
            {currentPage.sources && currentPage.sources.length > 0 && (
              <div className="flex flex-col gap-2 mt-1">
                <p className="text-[9px] uppercase tracking-widest font-black text-muted-foreground/50 mb-1">Sources</p>
                <div className="flex flex-col gap-1.5">
                  {currentPage.sources.map((s, i) => (
                    <div key={i} className="flex items-center gap-2 text-[10px] px-2 py-1.5 rounded-lg bg-surface border border-border text-muted-foreground">
                       <Link2 className="w-3 h-3 text-primary/60 shrink-0" />
                       <span className="font-semibold capitalize shrink-0">{s.type}:</span>
                       <span className="font-mono truncate" title={s.id}>{s.id.slice(0, 12)}…</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tags */}
            {currentPage.tags.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-[9px] uppercase tracking-widest font-black text-muted-foreground/50 mb-1">Tags</p>
                <div className="flex flex-wrap gap-1">
                  {currentPage.tags.map(t => (
                    <span
                      key={t}
                      onClick={() => setSearchQuery(t)}
                      className="text-[9px] px-1.5 py-0.5 rounded-md bg-surface border border-border text-muted-foreground cursor-pointer hover:border-primary/30 hover:text-primary transition-colors"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
