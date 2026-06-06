import axios from 'axios';
import { Logger } from '../utils/Logger';
import { KGManager } from './KGManager';
import { documentIngester } from './DocumentIngester';
import { getSession } from '../db/neo4j';
import { config } from '../config';

export class GiteaService {
  private static baseUrl = process.env.GITEA_URL || '';
  private static get isConfigured() { return !!process.env.GITEA_URL && !!GiteaService.token; }
  private static token = process.env.GITEA_TOKEN;
  private static ingester = documentIngester;

  public static async init() {
    if (!this.token) {
      Logger.warn('GiteaService', 'GITEA_TOKEN not set. Gitea integration disabled.');
      return;
    }
    Logger.info('GiteaService', `Initialized for ${this.baseUrl}`);
    
    // Initial sync
    this.syncRepos().catch(err => Logger.error('GiteaService', `Initial sync failed: ${err.message}`));
    
    // Schedule periodic sync (every 6 hours)
    setInterval(() => this.syncRepos(), 6 * 60 * 60 * 1000);
  }

  public static async syncRepos() {
    Logger.info('GiteaService', 'Starting repository synchronization...');
    try {
      const allRepos: Map<number, any> = new Map();
      const configOwner = config.autoEvolution?.giteaRepoOwner;
      const configRepoName = config.autoEvolution?.giteaRepoName;

      if (configOwner && configRepoName) {
        // Specific repo configured - ONLY sync this one
        Logger.info('GiteaService', `Following client configuration: syncing specific repository ${configOwner}/${configRepoName}`);
        const repo = await this.getRepo(configOwner, configRepoName);
        if (repo) {
          allRepos.set(repo.id, repo);
        } else {
          Logger.warn('GiteaService', `Configured repository ${configOwner}/${configRepoName} not found.`);
        }
      } else if (configOwner) {
        // Only owner configured - sync all repos for this owner
        Logger.info('GiteaService', `Following client configuration: syncing all repositories for owner ${configOwner}`);
        const ownerRepos = await this.listReposForUser(configOwner);
        for (const repo of ownerRepos) {
          allRepos.set(repo.id, repo);
        }
      } else {
        // No specific config - fallback to authenticated user's repos
        Logger.info('GiteaService', 'No specific repository configuration found. Falling back to authenticated user repos.');
        const userRepos = await this.listUserRepos();
        for (const repo of userRepos) {
          allRepos.set(repo.id, repo);
        }
      }

      // Index all unique repos found
      const repos = Array.from(allRepos.values());
      if (repos.length === 0) {
        Logger.warn('GiteaService', 'No repositories found to synchronize.');
      }
      
      for (const repo of repos) {
        await this.indexRepo(repo);
      }
      Logger.info('GiteaService', `Synchronized ${repos.length} repositories.`);
    } catch (err: any) {
      Logger.error('GiteaService', `Sync failed: ${err.message}`);
    }
  }

  public static async listUserRepos(): Promise<any[]> {
    if (!this.token) return [];
    try {
      const res = await axios.get(`${this.baseUrl}/api/v1/user/repos`, {
        headers: { 'Authorization': `token ${this.token}` }
      });
      return res.data as any[];
    } catch (err: any) {
      Logger.error('GiteaService', `Failed to list user repos: ${err.message}`);
      return [];
    }
  }

  public static async listReposForUser(username: string): Promise<any[]> {
    if (!this.token) return [];
    try {
      const res = await axios.get(`${this.baseUrl}/api/v1/users/${username}/repos`, {
        headers: { 'Authorization': `token ${this.token}` }
      });
      return res.data as any[];
    } catch (err: any) {
      Logger.error('GiteaService', `Failed to list repos for user ${username}: ${err.message}`);
      return [];
    }
  }

  public static async getRepo(owner: string, name: string): Promise<any | null> {
    if (!this.token) return null;
    try {
      const res = await axios.get(`${this.baseUrl}/api/v1/repos/${owner}/${name}`, {
        headers: { 'Authorization': `token ${this.token}` }
      });
      return res.data;
    } catch (err: any) {
      Logger.error('GiteaService', `Failed to fetch repository ${owner}/${name}: ${err.message}`);
      return null;
    }
  }

  public static async createRepository(name: string, description?: string): Promise<any> {
    if (!this.token) throw new Error('Gitea token not configured');
    
    Logger.info('GiteaService', `Creating new repository: ${name}`);
    try {
      const res = await axios.post(`${this.baseUrl}/api/v1/user/repos`, {
        name,
        description: description || `Automated project: ${name}`,
        private: true,
        auto_init: true
      }, {
        headers: { 
          'Authorization': `token ${this.token}`,
          'Content-Type': 'application/json'
        }
      });
      
      // Index the new repo immediately
      await this.indexRepo(res.data);
      
      return res.data;
    } catch (err: any) {
      if (err.response?.status === 409) {
        Logger.warn('GiteaService', `Repository ${name} already exists, fetching details...`);
        const repos = await this.listUserRepos();
        return repos.find((r: any) => r.name === name);
      }
      throw err;
    }
  }

  private static async indexRepo(repo: any) {
    const session = getSession();
    
    // Determine provider mode from config (avoid generating dummy inference tasks)
    const routing = (config.routing?.preferredNode || 'AUTO').toUpperCase();
    const isCloud = routing === 'GEMINI' || routing === 'OPENROUTER';
    const mode = isCloud ? 'STANDARD' : 'DEEP';

    Logger.info('GiteaService', `Indexing repository ${repo.full_name} using config routing=${routing} (Mode: ${mode})`);

    try {
      // 1. Upsert Project/Repo node in Neo4j
      await session.run(`
        MERGE (p:Project {id: $id})
        SET p.name = $name,
            p.fullName = $fullName,
            p.description = $description,
            p.htmlUrl = $htmlUrl,
            p.sshUrl = $sshUrl,
            p.updatedAt = timestamp(),
            p.source = 'GITEA',
            p.ingestionMode = $mode
      `, {
        id: `gitea-${repo.id}`,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description,
        htmlUrl: repo.html_url,
        sshUrl: repo.ssh_url,
        mode
      });

      // 2. Handle empty repository initialization
      if (repo.empty) {
        await this.initializeRepo(repo);
        // After initialization, repo is no longer empty for subsequent logic
        repo.empty = false;
      }

      // 3. Fetch files based on rules
      if (!isCloud) {
        // Deep Ingestion: Fetch recursive file list
        await this.deepIngest(repo);
      } else {
        // Standard Ingestion: README + Docs only
        await this.limitedIngest(repo);
      }

    } finally {
      await session.close();
    }
  }

  private static async limitedIngest(repo: any) {
    const filesToFetch = ['README.md', 'docs/index.md', 'CONTRIBUTING.md'];
    for (const path of filesToFetch) {
        try {
            const res = await axios.get(`${this.baseUrl}/api/v1/repos/${repo.full_name}/raw/${path}`, {
                headers: { 'Authorization': `token ${this.token}` },
                responseType: 'text'
            }) as any;
            if (res.data && res.data.length > 10) {
                await this.enqueueForIngestion(repo, path, res.data, 'STANDARD');
            }
        } catch (e) {}
    }
  }

  private static async deepIngest(repo: any) {
    try {
        // Fetch recursive tree with truncation handling
        const tree = await this.fetchFullTree(repo.owner.login, repo.name, repo.default_branch);
        
        // Filter for text files, source code, and docs
        const extensions = ['.md', '.ts', '.tsx', '.js', '.py', '.go', '.rs', '.cpp', '.hpp', '.h', '.java', '.kt', '.json', '.css', '.html'];
        const files = tree.filter(f => 
            f.type === 'blob' && 
            extensions.some(ext => f.path.endsWith(ext)) &&
            !f.path.includes('node_modules/') &&
            !f.path.includes('.git/') &&
            !f.path.includes('dist/') &&
            !f.path.includes('build/')
        );

        Logger.info('GiteaService', `Deep Ingestion: Found ${files.length} relevant files in ${repo.full_name}`);

        // Index all relevant files found
        const targetFiles = files;
        Logger.info('GiteaService', `Repository ${repo.full_name}: enqueuing ${files.length} files for ingestion.`);

        for (const file of targetFiles) {
            try {
                const res = await axios.get(`${this.baseUrl}/api/v1/repos/${repo.full_name}/raw/${file.path}`, {
                    headers: { 'Authorization': `token ${this.token}` },
                    responseType: 'text'
                }) as any;
                if (res.data && res.data.length > 10) {
                    await this.enqueueForIngestion(repo, file.path, res.data, 'DEEP');
                }
            } catch (e) {}
        }
    } catch (err: any) {
        if (err.response?.status === 400 || err.response?.status === 404) {
            Logger.warn('GiteaService', `Deep ingestion skipped for ${repo.full_name}: repository might be empty or branch not found.`);
        } else {
            Logger.error('GiteaService', `Deep ingestion failed for ${repo.full_name}: ${err.message}`);
        }
    }
  }

  private static async fetchFullTree(owner: string, repo: string, sha: string): Promise<any[]> {
    const url = `${this.baseUrl}/api/v1/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`;
    const res = await axios.get(url, {
      headers: { 'Authorization': `token ${this.token}` }
    }) as any;

    const tree = res.data.tree as any[];
    
    // If not truncated, we have everything!
    if (!res.data.truncated) {
      return tree;
    }

    // If truncated, we need to fetch root tree without recursion and explore manually
    Logger.info('GiteaService', `Tree for ${owner}/${repo} is truncated (>${tree.length} items). Switching to manual recursive fetch...`);
    return this.manualRecursiveFetch(owner, repo, sha, '');
  }

  private static async manualRecursiveFetch(owner: string, repo: string, sha: string, currentPath: string = ''): Promise<any[]> {
    const url = `${this.baseUrl}/api/v1/repos/${owner}/${repo}/git/trees/${sha}`;
    const res = await axios.get(url, {
      headers: { 'Authorization': `token ${this.token}` }
    }) as any;

    const tree = res.data.tree as any[];
    const allFiles: any[] = [];

    for (const item of tree) {
      const fullPath = currentPath ? `${currentPath}/${item.path}` : item.path;
      if (item.type === 'blob') {
        allFiles.push({ ...item, path: fullPath });
      } else if (item.type === 'tree') {
        const subFiles = await this.manualRecursiveFetch(owner, repo, item.sha, fullPath);
        allFiles.push(...subFiles);
      }
    }
    return allFiles;
  }

  private static async initializeRepo(repo: any) {
    Logger.info('GiteaService', `Initializing empty repository ${repo.full_name} with README.md`);
    const content = `# ${repo.name}\n\nAutomated output repository for AIMindMesh tasks.`;
    await this.commitFile(repo.full_name, 'README.md', content, 'Initial commit (automated)');
  }

  /**
   * Writes or updates a file in a Gitea repo via Contents API.
   * If the file already exists, it retrieves the SHA and performs a PUT (update).
   * If it doesn't exist, it performs a POST (create).
   *
   * @param repoFullName  e.g. 'aimindmesh/ai-tasks-output'
   * @param filePath      relative path in the repo, e.g. 'tasks/2026-04-13/output.md'
   * @param content       textual content of the file
   * @param commitMessage commit message
   * @returns HTML URL of the commit on Gitea, or null if it fails
   */
  public static async commitFile(
    repoFullName: string,
    filePath: string,
    content: string,
    commitMessage: string
  ): Promise<string | null> {

    if (!this.token) {
      Logger.warn('GiteaService', 'commitFile: GITEA_TOKEN not configured, skipping commit.');
      return null;
    }

    const apiUrl = `${this.baseUrl}/api/v1/repos/${repoFullName}/contents/${filePath}`;
    const headers = {
      Authorization: `token ${this.token}`,
      'Content-Type': 'application/json',
    };
    const encodedContent = Buffer.from(content, 'utf-8').toString('base64');

    // 1. Controlla se il file esiste già — serve lo SHA per fare un update
    let existingSha: string | undefined;
    try {
      const checkRes = await axios.get(apiUrl, { headers }) as any;
      existingSha = checkRes.data?.sha;
    } catch (err: any) {
      if (err.response?.status !== 404) {
        Logger.warn('GiteaService', `commitFile: error checking file existence: ${err.message}`);
      }
      // 404 = file does not exist, proceed with creation
    }

    // 2. Payload base
    const payload: Record<string, unknown> = {
      message: commitMessage,
      content: encodedContent,
    };
    if (existingSha) {
      payload.sha = existingSha; // required for PUT
    }

    // 3. POST (new file) or PUT (update existing file)
    try {
      const method = existingSha ? 'put' : 'post';
      const res = await axios[method](apiUrl, payload, { headers }) as any;

      const commitUrl: string | null = res.data?.commit?.html_url ?? null;
      Logger.info(
        'GiteaService',
        `commitFile: ${existingSha ? 'updated' : 'created'} ${filePath} → ${commitUrl ?? 'no url'}`
      );
      return commitUrl;
    } catch (err: any) {
      Logger.error('GiteaService', `commitFile: unable to write ${filePath}: ${err.message}`);
      return null;
    }
  }

  private static async enqueueForIngestion(repo: any, filepath: string, content: string, mode: 'STANDARD' | 'DEEP') {
    const tempPath = `/tmp/gitea-${repo.id}-${filepath.replace(/\//g, '_')}`;
    const fs = require('fs/promises');
    await fs.writeFile(tempPath, content);
    
    await this.ingester.enqueueFile(tempPath, `${filepath} (${repo.name})`, 'text/plain', mode);
  }
}
