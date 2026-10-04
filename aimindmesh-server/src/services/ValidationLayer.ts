import fs from 'fs';
import path from 'path';
import { Logger } from '../utils/Logger';
import { config } from '../config';
import { CodeGenerationOutput } from './CodeGenerationTask';
import { isSelfRepo, normalizeRepoPath } from './evolution/EvolutionPathPolicy';
import { typecheckPatch, PatchFile, TypecheckResult } from './evolution/PatchTypeChecker';
import { runRelatedTests } from './evolution/PatchTestRunner';

export interface ValidationResult {
  passed: boolean;
  steps: ValidationStep[];
  errors: string[];
  warnings: string[];
}

interface ValidationStep {
  name: string;
  passed: boolean;
  output: string;
  durationMs: number;
}

export class ValidationLayer {
  private readonly TIMEOUT_MS = config.autoEvolution?.validationTimeoutMs ?? 60000;
  private readonly repoPath = config.autoEvolution?.repoLocalPath ?? path.join(__dirname, '../../');

  async validate(
    targetComponent: string,
    output: CodeGenerationOutput,
    originalContent?: string,
    options?: {
      feedbacks?: import('./FeedbackService').FeedbackRecord[];
      repository?: string;
    }
  ): Promise<ValidationResult> {
    const repository = options?.repository ?? 'AIMindMesh';
    const ext = path.extname(targetComponent).toLowerCase();
    const isJSorTS = ['.ts', '.tsx', '.js', '.jsx'].includes(ext);
    const warnings: string[] = [];
    const errors: string[] = [];

    Logger.info('ValidationLayer', `Starting validation for ${targetComponent} (Ext: ${ext})`);
    
    // 1. Structural checks
    if (output.skip) {
      return { passed: false, steps: [], errors: [output.skipReason ?? 'LLM requested skip'], warnings: [] };
    }

    if (!output.modifiedFileContent || output.modifiedFileContent.trim().length < 100) {
      return { passed: false, steps: [], errors: ['Generated content too short or empty'], warnings: [] };
    }

    // Truncated file check (TS/JS specific)
    let newDeps: string[] = [];
    if (isJSorTS) {
      const trimmed = output.modifiedFileContent.trim();
      if (!trimmed.endsWith('}') && !trimmed.endsWith(';') && !trimmed.endsWith('*/')) {
        errors.push('File appears truncated (no closing brace, semicolon or comment)');
      }

      // New dependencies check (NON-BLOCKING in v2.1)
      newDeps = await this.detectNewDependencies(targetComponent, output.modifiedFileContent);
      if (newDeps.length > 0) {
        warnings.push(`New external dependencies detected: ${newDeps.join(', ')}. Remember to run "npm install" after merging.`);
      }

      // ★ NEW [v2.0]: Public Signature check using provided originalContent
      if (originalContent) {
        const originalSigs = this.extractExportedSignatures(originalContent);
        const newSigs = this.extractExportedSignatures(output.modifiedFileContent);
        
        const removedSigs = originalSigs.filter(s => !newSigs.includes(s));
        if (removedSigs.length > 0 && !output.breakingChange) {
          errors.push(`Public signatures removed without breakingChange=true: ${removedSigs.join(', ')}`);
        }
      }
    }

    // ★ Feedback address check (only during feedback iterations)
    if (options?.feedbacks && options.feedbacks.length > 0) {
      const explanation = (output.explanation ?? '').toLowerCase();
      const addressedCount = options.feedbacks.filter(fb =>
        // Naive check: verify if at least some feedback keywords appear in the explanation
        fb.content.toLowerCase().split(' ')
          .filter(w => w.length > 4)
          .some(w => explanation.includes(w))
      ).length;

      if (addressedCount === 0) {
        warnings.push(
          `None of the ${options.feedbacks.length} developer feedback(s) appear to be addressed in the explanation. ` +
          `Review the output carefully.`
        );
      }
    }

    // If we have critical structural errors, stop here
    if (errors.length > 0) {
      return { passed: false, steps: [], errors, warnings };
    }

    const steps: ValidationStep[] = [];

    if (ext === '.json') {
      try {
        JSON.parse(output.modifiedFileContent);
      } catch (err: any) {
        errors.push(`Generated JSON is not valid: ${err.message}`);
      }
    }

    if (isJSorTS) {
      // Type-check the patched sources (not the unmodified repo)
      const start = Date.now();
      let result: TypecheckResult;
      try {
        result = await typecheckPatch(this.repoPath, this.collectPatchFiles(repository, targetComponent, output), this.TIMEOUT_MS);
      } catch (err: any) {
        result = { status: 'failed', errors: [`Type check could not complete: ${err.message}`], checkedFiles: [] };
      }

      if (result.status === 'skipped') {
        warnings.push(`${targetComponent} was not type-checked: only aimindmesh-server/src TypeScript files of the AIMindMesh repository can be.`);
      } else if (result.status === 'unavailable') {
        // Fail closed: a server TS change must never be proposed unchecked
        errors.push(`TypeScript type check unavailable: ${result.errors.join('; ')}`);
      } else {
        // Missing-module errors for newly introduced dependencies are expected until "npm install"
        const isNewDepError = (line: string) => newDeps.some(dep =>
          line.includes(`Cannot find module '${dep}'`) ||
          line.includes(`Could not find a declaration file for module '${dep}'`)
        );
        const blocking = result.errors.filter(line => !isNewDepError(line));
        if (blocking.length < result.errors.length) {
          warnings.push(`TSC reported missing modules for new dependencies: ${newDeps.join(', ')}`);
        }
        if (blocking.length > 0) {
          errors.push(`TypeScript type check: ${blocking.slice(0, 10).join('\n').slice(0, 1500)}`);
        }
        steps.push({
          name: 'TypeScript type check',
          passed: blocking.length === 0,
          output: result.errors.join('\n'),
          durationMs: Date.now() - start
        });

        // Tests that import the patched files, on the same kind of private copy
        if (blocking.length === 0 && config.autoEvolution?.runRelatedTests !== false) {
          const testStart = Date.now();
          const tests = await runRelatedTests(this.repoPath, this.collectPatchFiles(repository, targetComponent, output), this.TIMEOUT_MS * 3);
          if (tests.status === 'failed') errors.push(`Related tests failing:\n${tests.errors.join('\n').slice(0, 1500)}`);
          if (tests.status === 'unavailable') warnings.push(`Related tests not run: ${tests.errors.join('; ')}`);
          steps.push({ name: 'Related tests', passed: tests.status !== 'failed', output: tests.errors.join('\n'), durationMs: Date.now() - testStart });
        }
      }
    } else {
      Logger.info('ValidationLayer', `Skipping TypeScript validation for non-JS/TS file: ${ext}`);
    }

    return {
      passed: errors.length === 0,
      steps,
      errors,
      warnings
    };
  }

  private async detectNewDependencies(targetPath: string, newContent: string): Promise<string[]> {
    const importRegex = /from\s+['"]([^.][^'"]+)['"]/g; // Matches non-relative imports
    const newImports = new Set<string>();
    let m;
    while ((m = importRegex.exec(newContent)) !== null) {
      // Ignore built-in node modules
      if (!m[1].startsWith('node:') && !['fs', 'path', 'os', 'child_process', 'util', 'crypto', 'http', 'https'].includes(m[1])) {
        newImports.add(m[1]);
      }
    }

    if (newImports.size === 0) return [];

    try {
      // Read package.json to check existing dependencies
      const pkgPath = path.join(this.repoPath, 'package.json');
      if (!fs.existsSync(pkgPath)) return [];
      
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const existingDeps = new Set([
        ...Object.keys(pkg.dependencies || {}),
        ...Object.keys(pkg.devDependencies || {})
      ]);

      const brandNew = Array.from(newImports).filter(dep => {
        // Handle scoped packages or sub-paths (e.g. @types/node or lodash/map)
        const baseDep = dep.startsWith('@') ? dep.split('/').slice(0, 2).join('/') : dep.split('/')[0];
        return !existingDeps.has(baseDep);
      });

      return brandNew;
    } catch (e) {
      Logger.warn('ValidationLayer', `Failed to check dependencies: ${e instanceof Error ? e.message : String(e)}`);
      return [];
    }
  }


  private extractExportedSignatures(content: string): string[] {
    const sigRegex = /export\s+(?:async\s+)?(?:function|class|const|interface|type|enum)\s+(\w+)/g;
    const sigs: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = sigRegex.exec(content)) !== null) {
      sigs.push(m[1]);
    }
    return sigs;
  }

  /** Repo-root paths and contents of every file the proposal would commit (self repo only). */
  private collectPatchFiles(repository: string, targetComponent: string, output: CodeGenerationOutput): PatchFile[] {
    if (!isSelfRepo(repository)) return [];
    const candidates: { path: unknown; content: unknown }[] = [
      { path: targetComponent, content: output.modifiedFileContent },
      ...(output.additionalFiles ?? []).map(f => ({ path: f?.path, content: f?.content })),
    ];
    // Unit tests are compiled too: tsconfig includes src/**, so a broken test would break the build
    if (output.unitTestContent && output.unitTestPath) {
      candidates.push({ path: output.unitTestPath, content: output.unitTestContent });
    }
    const files: PatchFile[] = [];
    for (const c of candidates) {
      const normalized = normalizeRepoPath(repository, c.path);
      if (normalized && typeof c.content === 'string') files.push({ path: normalized, content: c.content });
    }
    return files;
  }
}
