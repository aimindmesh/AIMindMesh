import fs from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Logger } from '../utils/Logger';
import { config } from '../config';
import { CodeGenerationOutput } from './CodeGenerationTask';

const execAsync = promisify(exec);

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
    }
  ): Promise<ValidationResult> {
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
    const tempDir = await this.writeTempFiles(targetComponent, output);

    try {
      if (isJSorTS) {
        // Step 1: TypeScript type check
        steps.push(await this.runStep(
          'TypeScript type check',
          `npx tsc --noEmit --strict`,
          { cwd: this.repoPath }
        ));

        // Step 2: ESLint
        steps.push(await this.runStep(
          'ESLint',
          `npx eslint ${tempDir}/${path.basename(targetComponent)} --max-warnings 10`,
          { cwd: this.repoPath }
        ));
      } else {
        Logger.info('ValidationLayer', `Skipping TS/ESLint validation for non-JS/TS file: ${ext}`);
      }
    } catch (err: any) {
      Logger.error('ValidationLayer', `Validation process crashed: ${err.message}`);
    } finally {
      // Clean up temp files
      await fs.promises.rm(tempDir, { recursive: true, force: true });
    }

    // Process steps to separate blocking errors from warnings
    for (const step of steps) {
      if (!step.passed) {
        const outputText = step.output;
        
        // Ignore ESLint config errors
        if (outputText.includes('ESLint couldn\'t find an eslint.config')) continue;

        // Check if TSC failure is just because of missing modules (new dependencies)
        if (step.name === 'TypeScript type check' && newDeps.length > 0) {
          const missingModuleErrors = newDeps.some(dep => 
            outputText.includes(`Cannot find module '${dep}'`) || 
            outputText.includes(`Could not find a declaration file for module '${dep}'`)
          );
          
          if (missingModuleErrors) {
            warnings.push(`TSC failed because of new dependencies: ${step.output.slice(0, 300)}...`);
            continue;
          }
        }

        errors.push(`${step.name}: ${step.output.slice(0, 500)}`);
      }
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


  private async runStep(
    name: string,
    command: string,
    options: any
  ): Promise<ValidationStep> {
    const start = Date.now();
    try {
      const { stdout, stderr } = await execAsync(command, {
        ...options,
        timeout: this.TIMEOUT_MS
      });
      return {
        name,
        passed: true,
        output: String(stdout) + String(stderr),
        durationMs: Date.now() - start
      };
    } catch (err: any) {
      return {
        name,
        passed: false,
        output: (err.stdout || '') + (err.stderr || '') + (err.message || ''),
        durationMs: Date.now() - start
      };
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

  private async writeTempFiles(

    targetComponent: string,
    output: CodeGenerationOutput
  ): Promise<string> {
    const tempDir = path.join(os.tmpdir(), `autoevo-${Date.now()}`);
    await fs.promises.mkdir(tempDir, { recursive: true });
    await fs.promises.writeFile(
      path.join(tempDir, path.basename(targetComponent)),
      output.modifiedFileContent
    );
    if (output.unitTestContent && output.unitTestPath) {
      await fs.promises.writeFile(
        path.join(tempDir, path.basename(output.unitTestPath)),
        output.unitTestContent
      );
    }
    return tempDir;
  }
}
