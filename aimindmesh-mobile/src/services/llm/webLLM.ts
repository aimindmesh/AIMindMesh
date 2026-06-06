import { CreateMLCEngine, MLCEngine, InitProgressReport, prebuiltAppConfig } from "@mlc-ai/web-llm";
import { Message, Personality, Memory } from "../../types";
import { buildSystemPrompt } from "./promptBuilder";
import { logger } from "../logger";

// We use the IDs from the official prebuiltAppConfig for maximum stability
// Prioritize smaller models for mobile devices
export const GGUF_MODELS = [
    // Small models - Recommended for mobile
    {
        id: "Phi-3-mini-4k-instruct-q4f32_1-MLC",
        name: "Phi-3 Mini 4K (Recommended)",
        size: "~2.4GB",
        description: "Best balance for mobile. Fast and capable.",
        category: "mobile"
    },
    {
        id: "gemma-2-2b-it-q4f32_1-MLC",
        name: "Gemma 2 2B Instruct",
        size: "~1.5GB",
        description: "Lightweight and efficient for basic tasks.",
        category: "mobile"
    },
    {
        id: "Qwen2-1.5B-Instruct-q4f32_1-MLC",
        name: "Qwen2 1.5B Instruct",
        size: "~1.2GB",
        description: "Smallest model, very fast responses.",
        category: "mobile"
    },

    // Medium models - Require more RAM
    {
        id: "Llama-3-8B-Instruct-q4f32_1-MLC",
        name: "Llama 3 8B Instruct",
        size: "~4.8GB",
        description: "High quality responses, requires 8GB+ RAM.",
        category: "desktop"
    },
    {
        id: "Mistral-7B-Instruct-v0.3-q4f32_1-MLC",
        name: "Mistral 7B Instruct v0.3",
        size: "~4.2GB",
        description: "Excellent for complex tasks, needs desktop hardware.",
        category: "desktop"
    },
];

/**
 * Get model information by ID
 */
export function getModelInfo(modelId: string) {
    return GGUF_MODELS.find(m => m.id === modelId);
}


let engine: MLCEngine | undefined;

export const checkWebGPUSupport = async (): Promise<{ supported: boolean; message?: string }> => {
    if (!('gpu' in navigator)) {
        return { supported: false, message: "WebGPU is not supported by this browser/device." };
    }
    try {
        const adapter = await (navigator as any).gpu.requestAdapter();
        if (!adapter) {
            return { supported: false, message: "WebGPU adapter not found. Your GPU might be blocklisted or drivers are outdated." };
        }
        return { supported: true };
    } catch (e) {
        return { supported: false, message: `WebGPU check failed: ${e}` };
    }
};

// Initialize the engine from a preset model using official config
export async function init(modelId: string, onProgress: (progress: number, text: string) => void) {
    const gpuCheck = await checkWebGPUSupport();
    if (!gpuCheck.supported) {
        throw new Error(gpuCheck.message || "WebGPU required.");
    }

    try {
        const onProgressCallback = (report: InitProgressReport) => {
            onProgress(report.progress * 100, report.text);
        };

        if (engine) await engine.unload();

        // Use prebuiltAppConfig to ensure URLs are Cache-API friendly
        engine = await CreateMLCEngine(modelId, {
            initProgressCallback: onProgressCallback,
            appConfig: prebuiltAppConfig,
            logLevel: "INFO"
        });

        const modelInfo = getModelInfo(modelId);
        logger.log('info', "WebLLM Engine is ready.", {
            modelId,
            modelName: modelInfo?.name || 'Unknown'
        });
    } catch (e: any) {
        logger.log('error', "Error initializing WebLLM engine", e);

        // Provide more helpful error messages
        if (e.message?.includes("compatible GPU") || e.toString().includes("GPU")) {
            throw new Error(
                "No compatible GPU found. On Android, WebGPU support is experimental. " +
                "Try updating Chrome/WebView or enabling WebGPU flags. " +
                "Desktop users: ensure GPU drivers are updated."
            );
        }

        if (e.message?.includes("out of memory") || e.message?.includes("OOM")) {
            const modelInfo = getModelInfo(modelId);
            throw new Error(
                `Model too large for this device (${modelInfo?.size || 'unknown size'}). ` +
                "Try a smaller model like Phi-3 Mini or Gemma 2 2B."
            );
        }

        if (e.message?.includes("network") || e.message?.includes("fetch")) {
            throw new Error(
                "Network error while downloading model. Please check your internet connection and try again."
            );
        }

        throw e;
    }
}

export async function unload() {
    if (engine) {
        logger.log('info', 'Unloading WebLLM engine to free resources...');
        await engine.unload();
        engine = undefined;
    }
}

export function isReady(): boolean {
    return !!engine;
}

export async function* generateStream(history: Message[], personality: Personality, memories?: Memory[], signal?: AbortSignal): AsyncGenerator<string> {
    if (!engine) {
        const err = new Error("WebLLM engine is not initialized. Please select and load a model in settings.");
        logger.log('error', err.message);
        throw err;
    }

    const systemPrompt = buildSystemPrompt(personality, memories);

    const messagesPayload: any[] = [
        { role: 'system', content: systemPrompt },
        ...history.map(m => ({
            role: m.role === 'model' ? 'assistant' : 'user',
            content: m.text
        }))
    ];

    try {
        const chunks = await engine.chat.completions.create({
            stream: true,
            messages: messagesPayload,
            temperature: 0.8,
            top_p: 0.95,
        });

        for await (const chunk of chunks) {
            // Check if generation was aborted
            if (signal?.aborted) {
                logger.log('info', 'WebLLM stream generation was aborted by user');
                // Note: WebLLM doesn't have a built-in cancel method, so we just stop iterating
                throw new DOMException('Generation aborted by user', 'AbortError');
            }

            const delta = chunk.choices[0]?.delta?.content;
            if (delta) {
                yield delta;
            }
        }
    } catch (e: any) {
        // Don't log abort errors as errors
        if (e.name === 'AbortError') {
            throw e;
        }

        if (e.message?.includes("device was lost") || e.toString().includes("device was lost")) {
            throw new Error("GPU Device lost. This usually happens if the model uses too much memory. Try a smaller model (e.g. Gemma 2B or Phi 3).");
        }
        throw e;
    }
}