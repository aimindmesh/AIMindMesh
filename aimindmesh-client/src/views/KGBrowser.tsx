import { useState, useRef, useEffect } from 'react';
import { Search, Network, Box, Cpu, BarChart3, ChevronRight, X, RefreshCw } from 'lucide-react';
import ForceGraph2D from 'react-force-graph-2d';
import ForceGraph3D from 'react-force-graph-3d';
import { serverApi } from '../services/serverApi';
import { Logger } from '../utils/logger';
import { useKnowledgeStore } from '../store/knowledgeStore';
import { useUIStore } from '../store/uiStore';
import { ConceptCard, MemoryCard, DocumentCard, InsightCard } from '../components/kg/EntitySidebarComponents';
import { useVisibility } from '../hooks/useVisibility';

interface KGNode {
  id: string;
  name?: string;
  title?: string;
  labels?: string[];
  [key: string]: any;
}

interface KGEdge {
  source: string;
  target: string;
  type: string;
  weight?: number;
}

interface GraphStats {
  nodeCount: number;
  linkCount: number;
  hubs: any[];
}

export default function KGBrowser() {
  const [query, setQuery] = useState('');
  const [graphData, setGraphData] = useState<{nodes: KGNode[], links: KGEdge[]}>({ nodes: [], links: [] });
  const [selectedNode, setSelectedNode] = useState<KGNode | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const { performanceMode } = useUIStore();
  const [is3D, setIs3D] = useState(false); // DEFAULT TO 2D FOR STABILITY
  const [stats, setStats] = useState<GraphStats | null>(null);
  const [showStats, setShowStats] = useState(false);
  const { isActive } = useVisibility();
  
  const graphRef = useRef<any>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  // Load stats and initial hubs
  const loadStats = async () => {
    try {
      const res = await serverApi.get('/api/kg/stats');
      setStats(res.data);
    } catch (e) {
      Logger.error('KGBrowser', 'Failed to load graph stats', e);
    }
  };

  const loadDiscoveryHubs = async () => {
    setIsSearching(true);
    try {
      // Usa una feature semantica neutra per far esplodere il grafo attorno ai core concepts, invece di stringa vuota (che crasha embedding)
      const res = await serverApi.post('/api/kg/explore', { query: 'Core neural concepts and documents', topK: 30 });
      setGraphData(res.data);
      setTimeout(() => {
        if (graphRef.current) {
          if (is3D) graphRef.current.zoomToFit(800);
          else graphRef.current.zoomToFit(800);
        }
      }, 500);
    } catch (e) {
      Logger.error('KGBrowser', 'Neural discovery failed', e);
    } finally {
      setIsSearching(false);
    }
  };

  useEffect(() => {
    const observer = new ResizeObserver(entries => {
      if (entries[0]) {
        setDimensions({
          width: entries[0].contentRect.width,
          height: entries[0].contentRect.height
        });
      }
    });
    
    if (containerRef.current) observer.observe(containerRef.current);
    
    loadStats();
    loadDiscoveryHubs();

    return () => {
      observer.disconnect();
      if (graphRef.current) {
        if (is3D) graphRef.current.pauseAnimation();
        else graphRef.current.stopAnimation();
      }
    };
  }, [is3D]);

  useEffect(() => {
    if (!graphRef.current || !is3D) return;
    // PAUSE ANIMATION IF WINDOW HIDDEN OR PERFORMANCE MODE ACTIVE
    if (isActive && !performanceMode) graphRef.current.resumeAnimation();
    else graphRef.current.pauseAnimation();
  }, [isActive, is3D, performanceMode]);

  const { uploadJobs } = useKnowledgeStore();
  const isSyncing = uploadJobs.length > 0;

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    
    setIsSearching(true);
    setSelectedNode(null);

    try {
      Logger.info('KGBrowser', `Executing neural exploration for: ${query}`);
      const res = await serverApi.post('/api/kg/explore', { query, topK: 25 });
      setGraphData(res.data);
      
      setTimeout(() => {
        if (graphRef.current) graphRef.current.zoomToFit(600);
      }, 400);
    } catch (err) {
      Logger.error('KGBrowser', 'Neural exploration failed', err);
    } finally {
      setIsSearching(false);
    }
  };

  const handleNodeClick = async (node: any) => {
    setSelectedNode(node);
    
    // Auto-expand neighbors on click
    try {
      const res = await serverApi.get(`/api/kg/neighbors/${node.id}?depth=1`);
      const { nodes: newNodes, links: newLinks } = res.data;
      
      setGraphData(prev => {
        const nodesMap = new Map(prev.nodes.map(n => [n.id, n]));
        newNodes.forEach((n: any) => nodesMap.set(n.id, n));
        
        const linksSet = new Set(prev.links.map(l => `${l.source}-${l.target}`));
        const filteredLinks = newLinks.filter((l: any) => {
          const key = `${l.source}-${l.target}`;
          if (!linksSet.has(key)) {
            linksSet.add(key);
            return true;
          }
          return false;
        });

        return {
          nodes: Array.from(nodesMap.values()),
          links: [...prev.links, ...filteredLinks]
        };
      });
    } catch (err) {
      Logger.warn('KGBrowser', `Failed to expand neighbors for node ${node.id}`);
    }
  };

  const handleDeleteNode = async (id: string) => {
    if (!confirm('Are you sure you want to permanently delete this node from the Knowledge Graph? This cannot be undone.')) return;
    
    try {
      await serverApi.delete(`/api/kg/nodes/${id}`);
      setGraphData(prev => ({
        nodes: prev.nodes.filter(n => n.id !== id),
        links: prev.links.filter(l => l.source !== id && l.target !== id)
      }));
      setSelectedNode(null);
      loadStats(); // refresh counts
      Logger.info('KGBrowser', `Node ${id} detached and removed from graph.`);
    } catch (err) {
      Logger.error('KGBrowser', `Failed to delete node ${id}`, err);
    }
  };

  const handleFocusNode = (id: string) => {
    if (!graphRef.current) return;
    const node = graphData.nodes.find(n => n.id === id);
    if (!node) return;

    if (is3D) {
      const distance = 150;
      const distRatio = 1 + distance/Math.hypot(node.x, node.y, node.z);
      graphRef.current.cameraPosition(
        { x: node.x * distRatio, y: node.y * distRatio, z: node.z * distRatio },
        node,
        2000
      );
    } else {
      graphRef.current.centerAt(node.x, node.y, 1000);
      graphRef.current.zoom(4, 1000);
    }
  };

  const getNodeColor = (node: any) => {
    // react-force-graph usa WebGL/Canvas: non supporta le variabili CSS nativamente, servono stringhe Hex
    const lbl = node.labels?.[0] || 'Concept';
    if (lbl === 'Concept') return '#4f8ff7'; // primary
    if (lbl === 'Memory') return '#f59e0b'; // warning
    if (lbl === 'Document') return '#22c55e'; // success
    if (lbl === 'Insight') return '#a855f7'; // purple
    return '#64748b'; // default
  };

  const renderSidebarContent = () => {
    if (!selectedNode) return <div className="text-center text-muted-foreground mt-20 p-6">Select a neuron to reveal its properties.</div>;
    
    const label = selectedNode.labels?.[0] || 'Concept';
    const props = { node: selectedNode, onDelete: handleDeleteNode, onFocus: handleFocusNode };

    switch (label) {
      case 'Document': return <DocumentCard {...props} />;
      case 'Concept': return <ConceptCard {...props} />;
      case 'Memory': return <MemoryCard {...props} />;
      case 'Insight': return <InsightCard {...props} />;
      default: return <ConceptCard {...props} />;
    }
  };

  return (
    <div className="p-6 h-full flex flex-col gap-6 animate-fade-in max-w-[1500px] mx-auto w-full overflow-hidden">
      
      {/* HEADER & CONTROLS */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <Network className="w-8 h-8 text-primary" />
            Neural Explorer
          </h1>
          <p className="text-xs text-muted-foreground mt-1 font-medium flex items-center gap-2">
            Interactive visualization of the Knowledge Graph
            {stats && <span className="px-2 py-0.5 bg-surface-hover rounded-full border border-border text-[10px]">{stats.nodeCount} nodes • {stats.linkCount} links</span>}
          </p>
        </div>
        
        <div className="flex items-center gap-3">
          {/* 2D/3D Toggle */}
          <div className="flex bg-surface border border-border p-1 rounded-xl shadow-sm">
            <button 
              onClick={() => setIs3D(false)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${!is3D ? 'bg-primary text-white shadow-md' : 'text-muted-foreground hover:bg-surface-hover'}`}
            >
              2D
            </button>
            <button 
              onClick={() => setIs3D(true)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-2 ${is3D ? 'bg-primary text-white shadow-md' : 'text-muted-foreground hover:bg-surface-hover'}`}
            >
              <Box className="w-3.5 h-3.5" />
              3D
            </button>
          </div>

          <form onSubmit={handleSearch} className="relative w-64 lg:w-80">
            <input 
              type="text" 
              placeholder="Search concepts or memories..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="w-full bg-surface border border-border p-2.5 pl-10 rounded-xl outline-none focus:border-primary shadow-sm text-sm"
            />
            <Search className="w-4 h-4 absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            {isSearching && <div className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />}
          </form>

          <button 
            onClick={() => setShowStats(!showStats)}
            className={`p-2.5 rounded-xl border border-border transition-all ${showStats ? 'bg-primary/10 border-primary text-primary' : 'bg-surface hover:bg-surface-hover'}`}
            title="Graph Stats"
          >
            <BarChart3 className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="flex-1 flex gap-6 min-h-0 relative">
        
        {/* STATS OVERLAY */}
        {showStats && (
          <div className="absolute top-4 left-4 z-20 w-64 glass-panel rounded-2xl p-5 animate-in slide-in-from-top-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-sm tracking-tight capitalize">Network statistics</h3>
              <X className="w-4 h-4 text-muted-foreground cursor-pointer" onClick={() => setShowStats(false)} />
            </div>
            
            {!stats ? (
               <div className="text-center text-muted-foreground text-xs py-4 flex flex-col items-center gap-2">
                 <RefreshCw className="w-4 h-4 animate-spin text-primary" />
                 Analyzing graph topography...
               </div>
            ) : (
            <div className="space-y-4">
              <div className="flex justify-between items-end border-b border-border pb-2">
                <span className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">Concepts</span>
                <span className="text-xl font-bold font-mono">{stats.nodeCount}</span>
              </div>
              <div className="flex justify-between items-end border-b border-border pb-2">
                <span className="text-xs text-muted-foreground uppercase font-bold tracking-tighter">Synapses</span>
                <span className="text-xl font-bold font-mono">{stats.linkCount}</span>
              </div>
              <div>
                <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest block mb-2">Neural Hubs</span>
                <div className="space-y-1">
                  {stats.hubs.map((hub) => (
                    <div key={hub.id} className="flex items-center justify-between text-[11px] p-1.5 hover:bg-surface rounded transition-colors cursor-pointer group" onClick={() => handleFocusNode(hub.id)}>
                      <span className="truncate w-32 font-medium group-hover:text-primary transition-colors flex items-center gap-1.5">
                        <ChevronRight className="w-2.5 h-2.5" />
                        {hub.name}
                      </span>
                      <span className="text-muted-foreground font-mono">{hub.degree}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
            )}
          </div>
        )}

        {/* GRAPH CANVAS */}
        <div ref={containerRef} className="glass-panel flex-1 rounded-3xl overflow-hidden relative border border-border bg-[#070a14]/[0.4] shadow-2xl group">
           {isSyncing && (
             <div className="absolute top-4 right-4 z-10 flex items-center gap-2 px-3 py-1.5 bg-primary/20 border border-primary/30 rounded-lg backdrop-blur-md animate-pulse">
               <RefreshCw className="w-3 h-3 text-primary animate-spin" />
               <span className="text-[10px] font-bold text-primary uppercase tracking-widest">Neural Sync in progress...</span>
             </div>
           )}
           
           <div className="absolute bottom-4 left-4 z-10 flex gap-2">
             <button onClick={loadDiscoveryHubs} className="px-3 py-1.5 bg-surface/80 hover:bg-surface border border-border rounded-lg text-[10px] font-bold tracking-widest uppercase flex items-center gap-2 backdrop-blur-md transition-all">
               <Cpu className="w-3 h-3 text-primary" />
               Global Hubs
             </button>
             <button onClick={() => { setGraphData({nodes: [], links: []}); setQuery(''); }} className="px-3 py-1.5 bg-destructive/10 hover:bg-destructive/20 border border-destructive/20 rounded-lg text-[10px] font-bold tracking-widest uppercase flex items-center gap-2 backdrop-blur-md transition-all text-destructive">
               Clear Space
             </button>
           </div>

           {graphData.nodes.length === 0 ? (
             <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground bg-background/20">
               <div className="w-24 h-24 rounded-full border border-border flex items-center justify-center mb-6 animate-pulse">
                <Network className="w-12 h-12 opacity-30" />
               </div>
               <p className="text-lg font-bold tracking-tight">Neural Space Empty</p>
               <p className="text-sm opacity-60 mt-1">Initialize discovery or search to explore nodes.</p>
               <button onClick={loadDiscoveryHubs} className="mt-8 px-6 py-2 bg-primary text-white rounded-xl font-bold shadow-lg shadow-primary/20 hover:scale-105 transition-all">
                 Auto-Discover Hubs
               </button>
             </div>
           ) : (
             is3D ? (
               <ForceGraph3D
                 ref={graphRef}
                 width={dimensions.width}
                 height={dimensions.height}
                 graphData={graphData}
                 nodeLabel={(node: any) => node.name || node.title || 'Untitled Node'}
                 nodeColor={getNodeColor}
                 nodeRelSize={7}
                 nodeOpacity={0.9}
                 linkColor={() => 'rgba(79, 143, 247, 0.2)'}
                 linkWidth={1}
                 linkDirectionalParticles={performanceMode ? 0 : 2}
                 linkDirectionalParticleSpeed={0.005}
                 onNodeClick={handleNodeClick}
                 backgroundColor="#070a14"
                 showNavInfo={false}
                 d3AlphaDecay={0.05}
                 d3VelocityDecay={0.3}
               />
             ) : (
               <ForceGraph2D
                 ref={graphRef}
                 width={dimensions.width}
                 height={dimensions.height}
                 graphData={graphData}
                 nodeLabel={(node: any) => node.name || node.title || 'Untitled Node'}
                 nodeColor={getNodeColor}
                 nodeRelSize={7}
                 linkColor={() => 'rgba(79, 143, 247, 0.15)'}
                 linkDirectionalParticles={performanceMode ? 0 : 1}
                 linkDirectionalParticleSpeed={0.008}
                 onNodeClick={handleNodeClick}
                 backgroundColor="transparent"
                 d3AlphaDecay={0.05}
                 d3VelocityDecay={0.3}
               />
             )
           )}
        </div>

        {/* DETAILS SIDEBAR */}
        <div className={`w-80 lg:w-96 glass-panel rounded-3xl flex flex-col transition-all duration-500 shadow-2xl ${selectedNode ? 'translate-x-0 opacity-100' : 'translate-x-[110%] opacity-0 hidden xl:flex'}`}>
          <div className="p-6 border-b border-border bg-surface/[0.5] backdrop-blur-2xl rounded-t-3xl flex items-center justify-between">
            <h3 className="font-bold flex items-center gap-2 text-sm tracking-tight italic">
              <Cpu className="w-4 h-4 text-primary" /> Node Analysis
            </h3>
            <button 
              onClick={() => setSelectedNode(null)}
              className="p-1.5 hover:bg-surface-hover rounded-full transition-colors"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>
          <div className="p-6 flex-1 overflow-y-auto custom-scrollbar">
            {renderSidebarContent()}
          </div>
          
          {selectedNode && (
            <div className="p-4 bg-surface/50 border-t border-border mt-auto rounded-b-3xl">
              <div className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest text-center">Neural Hash</div>
              <div className="text-[10px] font-mono text-center opacity-40 mt-1">{selectedNode.id}</div>
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
