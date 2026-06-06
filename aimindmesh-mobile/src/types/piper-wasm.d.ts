declare module 'piper-wasm' {
    export function piperPhonemize(
        piperPhonemizeJsUrl: string,
        piperPhonemizeWasmUrl: string,
        piperPhonemizeDataUrl: string,
        workerUrl: string,
        modelConfigUrl: string,
        input: string,
        onProgress?: (progress: number) => void,
        onnxruntimeUrl?: string
    ): Promise<{
        phonemes: string[];
        phonemeIds: number[];
    }>;
}
