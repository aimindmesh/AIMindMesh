import { useState, useCallback } from 'react';
import { organizationApi, Directive, OrgRole, IdeaProposal, AuditLogEntry, DiscoveryConfig } from '../services/organizationApi';
import { AIMindMeshServerSettings } from '../types';

export function useOrganizationState() {
  const [directives, setDirectives] = useState<Directive[]>([]);
  const [ideas, setIdeas] = useState<IdeaProposal[]>([]);
  const [roles, setRoles] = useState<OrgRole[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveryConfig, setDiscoveryConfig] = useState<(DiscoveryConfig & { isRunning: boolean }) | null>(null);

  const fetchDirectives = useCallback(async (settings: AIMindMeshServerSettings) => {
    setLoading(true);
    setError(null);
    try {
      const data = await organizationApi.getDirectives(settings);
      setDirectives(data);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch directives');
    } finally {
      setLoading(false);
    }
  }, []);

  const createDirective = useCallback(async (settings: AIMindMeshServerSettings, payload: any) => {
    setLoading(true);
    setError(null);
    try {
      const newDir = await organizationApi.createDirective(settings, payload);
      setDirectives(prev => [...prev, newDir]);
    } catch (e: any) {
      setError(e.message || 'Failed to create directive');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const cancelDirective = useCallback(async (settings: AIMindMeshServerSettings, id: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.cancelDirective(settings, id);
      setDirectives(prev => prev.filter(d => d.id !== id));
    } catch (e: any) {
      setError(e.message || 'Failed to cancel directive');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchIdeas = useCallback(async (settings: AIMindMeshServerSettings) => {
    setLoading(true);
    setError(null);
    try {
      const data = await organizationApi.getIdeas(settings);
      setIdeas(data);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch ideas');
    } finally {
      setLoading(false);
    }
  }, []);

  const discoverIdeas = useCallback(async (settings: AIMindMeshServerSettings, topic: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await organizationApi.discoverIdeas(settings, topic);
      setIdeas(data);
    } catch (e: any) {
      setError(e.message || 'Failed to discover ideas');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchRoles = useCallback(async (settings: AIMindMeshServerSettings) => {
    setLoading(true);
    setError(null);
    try {
      const data = await organizationApi.getRoles(settings);
      setRoles(data);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch roles');
    } finally {
      setLoading(false);
    }
  }, []);

  const createRole = useCallback(async (settings: AIMindMeshServerSettings, roleInput: any) => {
    setLoading(true);
    setError(null);
    try {
      const role = await organizationApi.createRole(settings, roleInput);
      setRoles(prev => [...prev, role]);
    } catch (e: any) {
      setError(e.message || 'Failed to create role');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const archiveRole = useCallback(async (settings: AIMindMeshServerSettings, roleId: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.archiveRole(settings, roleId);
      setRoles(prev => prev.filter(r => r.id !== roleId));
    } catch (e: any) {
      setError(e.message || 'Failed to archive role');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateRole = useCallback(async (settings: AIMindMeshServerSettings, roleId: string, patch: any) => {
    setLoading(true);
    setError(null);
    try {
      const updated = await organizationApi.updateRole(settings, roleId, patch);
      setRoles(prev => prev.map(r => r.id === roleId ? { ...r, ...updated } : r));
    } catch (e: any) {
      setError(e.message || 'Failed to update role');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchAuditLogs = useCallback(async (settings: AIMindMeshServerSettings) => {
    setLoading(true);
    setError(null);
    try {
      const logs = await organizationApi.getAuditSummary(settings);
      setAuditLogs(logs);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch audit summary');
    } finally {
      setLoading(false);
    }
  }, []);

  const [repositories, setRepositories] = useState<any[]>([]);
  const [hrProposals, setHrProposals] = useState<any[]>([]);

  const fetchRepositories = useCallback(async (settings: AIMindMeshServerSettings) => {
    setLoading(true);
    setError(null);
    try {
      const data = await organizationApi.getRepositories(settings);
      setRepositories(data);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch repositories');
    } finally {
      setLoading(false);
    }
  }, []);

  const createRepository = useCallback(async (settings: AIMindMeshServerSettings, repo: any) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.createRepository(settings, repo);
      const data = await organizationApi.getRepositories(settings);
      setRepositories(data);
    } catch (e: any) {
      setError(e.message || 'Failed to create repository');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const bootstrapCiCd = useCallback(async (settings: AIMindMeshServerSettings, repoId: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.bootstrapCiCd(settings, repoId);
      const data = await organizationApi.getRepositories(settings);
      setRepositories(data);
    } catch (e: any) {
      setError(e.message || 'Failed to bootstrap CI/CD');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const runValidation = useCallback(async (settings: AIMindMeshServerSettings, repoId: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.runValidation(settings, repoId);
      const data = await organizationApi.getRepositories(settings);
      setRepositories(data);
    } catch (e: any) {
      setError(e.message || 'Failed to run validation');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchHRProposals = useCallback(async (settings: AIMindMeshServerSettings) => {
    setLoading(true);
    setError(null);
    try {
      const data = await organizationApi.getHRProposals(settings);
      setHrProposals(data);
    } catch (e: any) {
      setError(e.message || 'Failed to fetch HR proposals');
    } finally {
      setLoading(false);
    }
  }, []);

  const analyzeRecruitment = useCallback(async (settings: AIMindMeshServerSettings) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.analyzeRecruitment(settings);
      const data = await organizationApi.getHRProposals(settings);
      setHrProposals(data);
    } catch (e: any) {
      setError(e.message || 'Failed to analyze recruitment');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const materializeProposal = useCallback(async (settings: AIMindMeshServerSettings, proposalId: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.materializeProposal(settings, proposalId);
      const [p, r] = await Promise.all([
        organizationApi.getHRProposals(settings),
        organizationApi.getRoles(settings),
      ]);
      setHrProposals(p);
      setRoles(r);
    } catch (e: any) {
      setError(e.message || 'Failed to materialize proposal');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateProposal = useCallback(async (settings: AIMindMeshServerSettings, proposalId: string, update: any) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.updateProposal(settings, proposalId, update);
      const data = await organizationApi.getHRProposals(settings);
      setHrProposals(data);
    } catch (e: any) {
      setError(e.message || 'Failed to update proposal');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteProposal = useCallback(async (settings: AIMindMeshServerSettings, proposalId: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.deleteProposal(settings, proposalId);
      setHrProposals(prev => prev.filter(p => p.id !== proposalId));
    } catch (e: any) {
      setError(e.message || 'Failed to delete proposal');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const reviewIdea = useCallback(async (settings: AIMindMeshServerSettings, ideaId: string, humanFeedback?: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.reviewIdea(settings, ideaId, humanFeedback);
      const data = await organizationApi.getIdeas(settings);
      setIdeas(data);
      return data.find((i: IdeaProposal) => i.id === ideaId);
    } catch (e: any) {
      setError(e.message || 'Failed to review idea');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const approveIdea = useCallback(async (settings: AIMindMeshServerSettings, ideaId: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.approveIdea(settings, ideaId);
      const data = await organizationApi.getIdeas(settings);
      setIdeas(data);
    } catch (e: any) {
      setError(e.message || 'Failed to approve idea');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const deleteIdea = useCallback(async (settings: AIMindMeshServerSettings, ideaId: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.deleteIdea(settings, ideaId);
      setIdeas(prev => prev.filter(i => i.id !== ideaId));
    } catch (e: any) {
      setError(e.message || 'Failed to delete idea');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const updateIdea = useCallback(async (settings: AIMindMeshServerSettings, ideaId: string, update: { title: string; problemStatement: string; summary: string }) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.updateIdea(settings, ideaId, update);
      const data = await organizationApi.getIdeas(settings);
      setIdeas(data);
    } catch (e: any) {
      setError(e.message || 'Failed to update idea');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const clearSession = useCallback(async (settings: AIMindMeshServerSettings, sessionKey: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.clearSession(settings, sessionKey);
    } catch (e: any) {
      setError(e.message || 'Failed to clear session');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const generateDirectivesFromIdea = useCallback(async (settings: AIMindMeshServerSettings, ideaId: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.generateDirectivesFromIdea(settings, ideaId);
      const [dirs, ides] = await Promise.all([
        organizationApi.getDirectives(settings),
        organizationApi.getIdeas(settings),
      ]);
      setDirectives(dirs);
      setIdeas(ides);
    } catch (e: any) {
      setError(e.message || 'Failed to generate directives');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const transitionIdeaToDevelopment = useCallback(async (settings: AIMindMeshServerSettings, ideaId: string) => {
    setLoading(true);
    setError(null);
    try {
      await organizationApi.transitionIdeaToDevelopment(settings, ideaId);
      const [dirs, ides, reps] = await Promise.all([
        organizationApi.getDirectives(settings),
        organizationApi.getIdeas(settings),
        organizationApi.getRepositories(settings),
      ]);
      setDirectives(dirs);
      setIdeas(ides);
      setRepositories(reps);
    } catch (e: any) {
      setError(e.message || 'Failed to transition idea to development');
      throw e;
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshAll = useCallback(async (settings: AIMindMeshServerSettings) => {
    setLoading(true);
    setError(null);
    try {
      const [dirs, ides, rls, logs, reps, props, discovery] = await Promise.all([
        organizationApi.getDirectives(settings),
        organizationApi.getIdeas(settings),
        organizationApi.getRoles(settings),
        organizationApi.getAuditSummary(settings),
        organizationApi.getRepositories(settings),
        organizationApi.getHRProposals(settings),
        organizationApi.getDiscoveryStatus(settings).catch(() => null),
      ]);
      setDirectives(dirs);
      setIdeas(ides);
      setRoles(rls);
      setAuditLogs(logs);
      setRepositories(reps);
      setHrProposals(props);
      if (discovery) setDiscoveryConfig(discovery);
    } catch (e: any) {
      setError(e.message || 'Failed to refresh state');
    } finally {
      setLoading(false);
    }
  }, []);

  return {
    directives,
    ideas,
    roles,
    auditLogs,
    repositories,
    hrProposals,
    discoveryConfig,
    loading,
    error,
    fetchDirectives,
    createDirective,
    cancelDirective,
    fetchIdeas,
    discoverIdeas,
    fetchRoles,
    createRole,
    archiveRole,
    updateRole,
    fetchAuditLogs,
    fetchRepositories,
    createRepository,
    bootstrapCiCd,
    runValidation,
    fetchHRProposals,
    analyzeRecruitment,
    materializeProposal,
    updateProposal,
    deleteProposal,
    reviewIdea,
    approveIdea,
    deleteIdea,
    updateIdea,
    clearSession,
    generateDirectivesFromIdea,
    transitionIdeaToDevelopment,
    refreshAll,

    fetchDiscoveryConfig: async (settings: AIMindMeshServerSettings) => {
      try {
        const status = await organizationApi.getDiscoveryStatus(settings);
        setDiscoveryConfig(status);
      } catch { /* non-blocking */ }
    },

    updateDiscoveryConfig: async (settings: AIMindMeshServerSettings, patch: Partial<DiscoveryConfig>) => {
      setLoading(true);
      setError(null);
      try {
        const cfg = await organizationApi.updateDiscoveryConfig(settings, patch);
        setDiscoveryConfig({ ...cfg, isRunning: discoveryConfig?.isRunning ?? false });
      } catch (e: any) {
        setError(e.message || 'Failed to update discovery config');
        throw e;
      } finally {
        setLoading(false);
      }
    },

    triggerDiscovery: async (settings: AIMindMeshServerSettings) => {
      setLoading(true);
      setError(null);
      try {
        return await organizationApi.triggerDiscovery(settings);
      } catch (e: any) {
        setError(e.message || 'Failed to trigger discovery');
        throw e;
      } finally {
        setLoading(false);
      }
    },
  };
}
