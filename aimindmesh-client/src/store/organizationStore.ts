import { create } from 'zustand';
import { organizationApi, OrgRole, Directive, IdeaProposal, AuditLogEntry, DiscoveryConfig } from '../services/organizationApi';

interface OrganizationState {
  roles: OrgRole[];
  directives: Directive[];
  ideas: IdeaProposal[];
  auditLogs: AuditLogEntry[];
  repositories: any[];
  hrProposals: any[];
  loading: boolean;
  error: string | null;

  fetchRoles: () => Promise<void>;
  createRole: (role: Omit<OrgRole, 'id' | 'status' | 'createdAt' | 'updatedAt' | 'createdBy'>) => Promise<void>;
  updateRole: (roleId: string, patch: Partial<OrgRole>) => Promise<void>;
  archiveRole: (roleId: string) => Promise<void>;

  fetchDirectives: () => Promise<void>;
  createDirective: (directive: { title: string; description: string; goalType: string; priority: number; constraints?: any }) => Promise<void>;
  cancelDirective: (directiveId: string) => Promise<void>;

  fetchAuditLogs: () => Promise<void>;
  fetchIdeas: () => Promise<void>;
  discoverIdeas: (topic: string) => Promise<void>;
  updateIdea: (ideaId: string, update: { title: string; problemStatement: string; summary: string }) => Promise<void>;

  fetchRepositories: () => Promise<void>;
  createRepository: (repo: { namespace?: string; repoName: string; description?: string; visibility?: string; bootstrapTemplate?: string; enableCiCd?: boolean; createdFromIdeaId?: string }) => Promise<void>;
  bootstrapCiCd: (repoId: string) => Promise<void>;
  runValidation: (repoId: string) => Promise<void>;
  fetchHRProposals: () => Promise<void>;
  analyzeRecruitment: () => Promise<void>;
  materializeProposal: (proposalId: string) => Promise<void>;
  updateProposal: (proposalId: string, update: any) => Promise<void>;
  deleteProposal: (proposalId: string) => Promise<void>;
  reviewIdea: (ideaId: string, humanFeedback?: string) => Promise<void>;
  approveIdea: (ideaId: string) => Promise<void>;
  deleteIdea: (ideaId: string) => Promise<void>;
  generateDirectivesFromIdea: (ideaId: string) => Promise<void>;
  transitionIdeaToDevelopment: (ideaId: string) => Promise<void>;

  discoveryConfig: (DiscoveryConfig & { isRunning?: boolean }) | null;
  fetchDiscoveryConfig: () => Promise<void>;
  updateDiscoveryConfig: (patch: Partial<DiscoveryConfig>) => Promise<void>;
  triggerDiscovery: () => Promise<{ ideasFound: number; message?: string }>;
}

export const useOrganizationStore = create<OrganizationState>((set) => ({
  roles: [],
  directives: [],
  ideas: [],
  auditLogs: [],
  loading: false,
  error: null,
  discoveryConfig: null,

  fetchRoles: async () => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.getRoles();
      if (res.data.success) {
        set({ roles: res.data.roles });
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to fetch roles' });
    } finally {
      set({ loading: false });
    }
  },

  createRole: async (roleInput) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.createRole(roleInput);
      if (res.data.success) {
        set((s) => ({ roles: [...s.roles, res.data.role] }));
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to create role' });
    } finally {
      set({ loading: false });
    }
  },

  updateRole: async (roleId, patch) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.updateRole(roleId, patch);
      if (res.data.success) {
        set((s) => ({
          roles: s.roles.map((r) => (r.id === roleId ? res.data.role : r)),
        }));
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to update role' });
    } finally {
      set({ loading: false });
    }
  },

  archiveRole: async (roleId) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.archiveRole(roleId);
      if (res.data.success) {
        set((s) => ({ roles: s.roles.filter((r) => r.id !== roleId) }));
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to archive role' });
    } finally {
      set({ loading: false });
    }
  },

  fetchDirectives: async () => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.getDirectives();
      if (res.data.success) {
        set({ directives: res.data.directives });
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to fetch directives' });
    } finally {
      set({ loading: false });
    }
  },

  createDirective: async (dirInput) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.createDirective(dirInput);
      if (res.data.success) {
        set((s) => ({ directives: [...s.directives, res.data.directive] }));
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to create directive' });
    } finally {
      set({ loading: false });
    }
  },

  cancelDirective: async (directiveId) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.cancelDirective(directiveId);
      if (res.data.success) {
        set((s) => ({
          directives: s.directives.filter((d) => d.id !== directiveId),
        }));
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to cancel directive' });
    } finally {
      set({ loading: false });
    }
  },

  fetchAuditLogs: async () => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.getAuditLogs();
      if (res.data.success) {
        set({ auditLogs: res.data.logs });
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to fetch audit logs' });
    } finally {
      set({ loading: false });
    }
  },

  fetchIdeas: async () => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.getIdeas();
      if (res.data.success) {
        set({ ideas: res.data.ideas });
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to fetch ideas' });
    } finally {
      set({ loading: false });
    }
  },

  discoverIdeas: async (topic) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.discoverIdeas(topic);
      if (res.data.success) {
        set((s) => {
          const newIdeas = res.data.ideas;
          const merged = [...s.ideas];
          newIdeas.forEach((idea) => {
            if (!merged.some((i) => i.id === idea.id)) {
              merged.push(idea);
            }
          });
          return { ideas: merged };
        });
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to discover ideas' });
    } finally {
      set({ loading: false });
    }
  },

  updateIdea: async (ideaId, update) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.updateIdea(ideaId, update);
      if (res.data.success) {
        const resIdeas = await organizationApi.getIdeas();
        set({ ideas: resIdeas.data.ideas });
      }
    } catch (err: any) {
      set({ error: err.message || 'Failed to update idea' });
    } finally {
      set({ loading: false });
    }
  },

  repositories: [],
  hrProposals: [],

  fetchRepositories: async () => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.getRepositories();
      if (res.data.success) {
        set({ repositories: res.data.repositories });
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to fetch repositories' });
    } finally {
      set({ loading: false });
    }
  },

  createRepository: async (repoInput) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.createRepository(repoInput);
      if (res.data.success) {
        await useOrganizationStore.getState().fetchRepositories();
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to create repository' });
    } finally {
      set({ loading: false });
    }
  },

  bootstrapCiCd: async (repoId) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.bootstrapCiCd(repoId);
      if (res.data.success) {
        await useOrganizationStore.getState().fetchRepositories();
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to bootstrap CI/CD' });
    } finally {
      set({ loading: false });
    }
  },

  runValidation: async (repoId) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.runValidation(repoId);
      if (res.data.success) {
        await useOrganizationStore.getState().fetchRepositories();
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to run validation' });
    } finally {
      set({ loading: false });
    }
  },

  fetchHRProposals: async () => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.getHRProposals();
      if (res.data.success) {
        set({ hrProposals: res.data.proposals });
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to fetch HR proposals' });
    } finally {
      set({ loading: false });
    }
  },

  analyzeRecruitment: async () => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.analyzeRecruitment();
      if (res.data.success) {
        await useOrganizationStore.getState().fetchHRProposals();
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to analyze recruitment' });
    } finally {
      set({ loading: false });
    }
  },

  materializeProposal: async (proposalId) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.materializeProposal(proposalId);
      if (res.data.success) {
        await Promise.all([
          useOrganizationStore.getState().fetchHRProposals(),
          useOrganizationStore.getState().fetchRoles()
        ]);
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to materialize proposal' });
    } finally {
      set({ loading: false });
    }
  },

  updateProposal: async (proposalId, update) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.updateProposal(proposalId, update);
      if (res.data.success) {
        await useOrganizationStore.getState().fetchHRProposals();
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to update proposal' });
    } finally {
      set({ loading: false });
    }
  },

  deleteProposal: async (proposalId) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.deleteProposal(proposalId);
      if (res.data.success) {
        set((s) => ({
          hrProposals: s.hrProposals.filter((p) => p.id !== proposalId),
        }));
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to delete proposal' });
    } finally {
      set({ loading: false });
    }
  },

  reviewIdea: async (ideaId, humanFeedback) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.reviewIdea(ideaId, humanFeedback);
      if (res.data.success) {
        await useOrganizationStore.getState().fetchIdeas();
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to review idea' });
    } finally {
      set({ loading: false });
    }
  },

  approveIdea: async (ideaId) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.approveIdea(ideaId);
      if (res.data.success) {
        await useOrganizationStore.getState().fetchIdeas();
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to approve idea' });
    } finally {
      set({ loading: false });
    }
  },

  deleteIdea: async (ideaId) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.deleteIdea(ideaId);
      if (res.data.success) {
        set((s) => ({
          ideas: s.ideas.filter((i) => i.id !== ideaId),
        }));
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to delete idea' });
    } finally {
      set({ loading: false });
    }
  },

  generateDirectivesFromIdea: async (ideaId) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.generateDirectivesFromIdea(ideaId);
      if (res.data.success) {
        await Promise.all([
          useOrganizationStore.getState().fetchDirectives(),
          useOrganizationStore.getState().fetchIdeas()
        ]);
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to generate directives' });
    } finally {
      set({ loading: false });
    }
  },

  transitionIdeaToDevelopment: async (ideaId) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.transitionIdeaToDevelopment(ideaId);
      if (res.data.success) {
        await Promise.all([
          useOrganizationStore.getState().fetchDirectives(),
          useOrganizationStore.getState().fetchIdeas(),
          useOrganizationStore.getState().fetchRepositories()
        ]);
      }
    } catch (e: any) {
      set({ error: e.message || 'Failed to transition idea to development' });
    } finally {
      set({ loading: false });
    }
  },

  fetchDiscoveryConfig: async () => {
    try {
      const res = await organizationApi.getDiscoveryStatus();
      if (res.data.success) set({ discoveryConfig: res.data.status });
    } catch (e: any) {
      // non-blocking — don't surface this as main error
    }
  },

  updateDiscoveryConfig: async (patch) => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.updateDiscoveryConfig(patch);
      if (res.data.success) set({ discoveryConfig: res.data.config });
    } catch (e: any) {
      set({ error: e.message || 'Failed to update discovery config' });
    } finally {
      set({ loading: false });
    }
  },

  triggerDiscovery: async () => {
    set({ loading: true, error: null });
    try {
      const res = await organizationApi.triggerDiscovery();
      return { ideasFound: res.data.ideasFound ?? 0, message: res.data.message };
    } catch (e: any) {
      set({ error: e.message || 'Failed to trigger discovery' });
      return { ideasFound: 0, message: e.message };
    } finally {
      set({ loading: false });
    }
  },
}));

