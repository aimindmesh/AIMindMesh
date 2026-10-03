import { RepoProvisionRequest } from './types';
import axios from 'axios';
import { GiteaService } from '../GiteaService';
import { config } from '../../config';

export class GiteaOrganizationService {
  private get baseUrl(): string {
    return process.env.GITEA_URL || '';
  }

  private get token(): string | undefined {
    return process.env.GITEA_TOKEN;
  }

  async createRepository(request: RepoProvisionRequest): Promise<{ url: string; repoName: string }> {
    if (!this.token) {
      throw new Error('Gitea token is not configured in the environment.');
    }

    let currentUser = 'andrea';
    try {
      const userRes = await axios.get(`${this.baseUrl}/api/v1/user`, {
        headers: { 'Authorization': `token ${this.token}` }
      });
      currentUser = (userRes.data as any).username;
    } catch (e: any) {
      console.warn(`Failed to fetch current Gitea user: ${e.message}`);
    }

    const isOrg = request.namespace !== 'andrea' && request.namespace !== currentUser;

    if (isOrg) {
      try {
        await axios.post(`${this.baseUrl}/api/v1/orgs`, {
          username: request.namespace
        }, {
          headers: {
            'Authorization': `token ${this.token}`,
            'Content-Type': 'application/json'
          }
        });
      } catch (orgErr: any) {
        if (orgErr.response?.status !== 422) {
          console.warn(`Gitea organization auto-creation warning: ${orgErr.message}`);
        }
      }
    }

    const url = isOrg 
      ? `${this.baseUrl}/api/v1/orgs/${request.namespace}/repos` 
      : `${this.baseUrl}/api/v1/user/repos`;

    try {
      const res = await axios.post(url, {
        name: request.repoName,
        description: request.description || `Automated organization repository ${request.repoName}`,
        private: request.visibility !== 'public',
        auto_init: true
      }, {
        headers: {
          'Authorization': `token ${this.token}`,
          'Content-Type': 'application/json'
        }
      });

      const data = res.data as any;
      return {
        url: data.html_url,
        repoName: data.full_name
      };
    } catch (e: any) {
      if (e.response?.status === 409) {
        // Retrieve existing repository
        const repoFullName = `${request.namespace}/${request.repoName}`;
        return {
          url: `${this.baseUrl}/${repoFullName}`,
          repoName: repoFullName
        };
      }
      throw e;
    }
  }

  async bootstrapCi(repoFullName: string, template: string): Promise<void> {
    await GiteaService.commitFile(repoFullName, '.gitea/workflows/ci.yml', template, 'bootstrap CI/CD workflow');
  }

  async registerWebhook(namespace: string, repoName: string): Promise<void> {
    if (!this.token) return;

    // Server webhook URL — accessible from Gitea container on the internal Docker network
    const serverWebhookUrl = process.env.SERVER_WEBHOOK_URL
      || 'http://aimindmesh-server:3030/api/organization/webhooks/gitea';

    const headers = { 'Authorization': `token ${this.token}`, 'Content-Type': 'application/json' };
    const hooksUrl = `${this.baseUrl}/api/v1/repos/${namespace}/${repoName}/hooks`;
    // The server verifies X-Gitea-Signature with this secret (see api/routes/giteaWebhook.ts)
    const hook = {
      type: 'gitea',
      config: {
        url: serverWebhookUrl,
        content_type: 'json',
        secret: config.autoEvolution?.giteaWebhookSecret ?? '',
      },
      events: ['push', 'workflow_run', 'check_run'],
      active: true,
    };

    // Update an existing hook (e.g. registered before signatures were required) instead of duplicating it
    let existingId: number | undefined;
    try {
      const res: any = await axios.get(hooksUrl, { headers });
      existingId = (res.data as any[]).find(h => h?.config?.url === serverWebhookUrl)?.id;
    } catch {
      existingId = undefined; // listing failed: fall back to creating the hook
    }

    try {
      if (existingId) {
        const { type, ...patch } = hook;
        await axios.patch(`${hooksUrl}/${existingId}`, patch, { headers });
      } else {
        await axios.post(hooksUrl, hook, { headers });
      }
    } catch (e: any) {
      // 422 means webhook already exists — not an error
      if (e.response?.status !== 422) throw e;
    }
  }
}


