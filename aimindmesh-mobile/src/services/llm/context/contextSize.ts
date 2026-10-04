/**
 * Context window of the on-device models (Genie GGUF and QAIRT, llama.cpp GGUF, LiteRT).
 *
 * "auto" (the default) picks it from the phone. Gemma 4 shares most of its KV cache between
 * layers (f16, per token: E2B ~18 KB, E4B ~56 KB), so RAM is not the limit: the time to read the
 * whole prompt again after a cache reset is (650–950 tok/s on the NPU). 8192 on the 8 Elite
 * (Hexagon v79/v81, Fold7), 4096 elsewhere (Fold5, v73). A value the user sets by hand
 * (contextMode 'manual') is used as is. QAIRT bundles keep the context they were exported with.
 */
import type { LLMConfig } from '../../../types';
import { Genie } from 'genie-capacitor';
import { logger } from '../../logger';

export const AUTO_CONTEXT_FAST = 8192;
export const AUTO_CONTEXT_DEFAULT = 4096;

const ARCH_KEY = 'aimm-npu-arch';
const FAST_ARCHS = new Set(['v79', 'v81']);

let npuArch: string | null | undefined;
let detecting: Promise<void> | null = null;

function cachedArch(): string | null {
    if (npuArch !== undefined) return npuArch;
    try {
        npuArch = localStorage.getItem(ARCH_KEY);
    } catch {
        npuArch = null;
    }
    return npuArch;
}

/** Context "auto" gives on a phone with this NPU */
export function autoContextFor(arch: string | null | undefined): number {
    return arch && FAST_ARCHS.has(arch.toLowerCase()) ? AUTO_CONTEXT_FAST : AUTO_CONTEXT_DEFAULT;
}

/**
 * Reads the NPU of the phone once (kept for the next launches). Awaited before a model is
 * loaded, so the first load already has the right context.
 */
export function detectDeviceContext(): Promise<void> {
    if (npuArch !== undefined && npuArch !== null) return Promise.resolve();
    detecting ??= Promise.resolve()
        .then(() => Genie.getCapabilities())
        .then(caps => {
            npuArch = caps.npuArch ?? null;
            try {
                if (npuArch) localStorage.setItem(ARCH_KEY, npuArch);
            } catch { /* private storage: detected again next launch */ }
        })
        .catch(e => {
            logger.log('warn', '[ContextSize] NPU not detected, auto context stays at the default', e);
            npuArch = cachedArch();
        });
    return detecting;
}

const isManual = (config: Partial<LLMConfig>) => config.contextMode === 'manual';

/** The value set by hand (both fields are kept in sync by the settings) */
const manualValue = (config: Partial<LLMConfig>) => config.nCtx || config.contextSize;

/** Context the setting asks for: by hand, or automatic for the phone */
function wantedContextSize(config: Partial<LLMConfig> | null | undefined): number {
    if (config && isManual(config) && manualValue(config)) return manualValue(config)!;
    return autoContextFor(cachedArch());
}

/** Context of the configured on-device engine (a Genie QAIRT bundle keeps its own) */
export function onDeviceContextSize(config: Partial<LLMConfig> | null | undefined): number {
    if (config?.provider === 'genie-npu') {
        const path = config.nativeModelPath || config.genieModelPath || '';
        return genieContextSize(config, path.trim().toLowerCase().endsWith('.gguf'));
    }
    return wantedContextSize(config);
}

/** QAIRT bundle context reported by the plugin after loading (undefined for GGUF or before load) */
let bundleContext: number | undefined;

export function setLoadedBundleContext(size: number | undefined): void {
    bundleContext = size && size > 0 ? size : undefined;
}

/**
 * Context of the Genie engine: a QAIRT bundle cannot go beyond the one it was exported with
 * (cl4096 for the Gemma-4-E4B bundle), a GGUF follows the setting.
 */
export function genieContextSize(config: Partial<LLMConfig> | null | undefined, isGguf: boolean): number {
    const wanted = wantedContextSize(config);
    if (isGguf) return wanted;
    return bundleContext ?? Math.min(wanted, AUTO_CONTEXT_DEFAULT);
}

/** Label for the settings: "Auto (8192)" or the manual value */
export function contextLabel(config: Partial<LLMConfig>): string {
    return isManual(config) && manualValue(config) ? `${manualValue(config)}` : `Auto (${autoContextFor(cachedArch())})`;
}
