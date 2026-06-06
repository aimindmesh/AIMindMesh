const blobs: Record<string, Blob> = {};
let worker: Worker | undefined;

export const HF_BASE = `https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/`;

/**
 * Generates phonemes using the Piper Phonemizer.
 *
 * @param {string} piperPhonemizeJsUrl - URL for the Piper phonemize JavaScript file.
 * @param {string} piperPhonemizeWasmUrl - URL for the Piper phonemize WASM file.
 * @param {string} piperPhonemizeDataUrl - URL for the Piper phonemize data file.
 * @param {string} workerUrl - URL for the Web Worker script.
 * @param {string} modelConfigUrl - URL for the model configuration file.
 * @param {string} input - Text input to be processed.
 * @param {function(number): void} onProgress - Callback function to handle progress updates.
 * @param {string = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.17.1/"} onnxruntimeUrl - URL for the ONNX Runtime Web.
 *
 * @returns {Promise<{
 *  phonemes: string[],
 *  phonemeIds: number[],
 * }>}
 */
export const piperPhonemize = (
    piperPhonemizeJsUrl: string,
    piperPhonemizeWasmUrl: string,
    piperPhonemizeDataUrl: string,
    workerUrl: string,
    modelConfigUrl: string,
    input: string,
    onProgress: (progress: number) => void,
    onnxruntimeUrl = "https://cdnjs.cloudflare.com/ajax/libs/onnxruntime-web/1.17.1/"
): Promise<{ phonemes: string[]; phonemeIds: number[] }> => {
    const piperPromise = new Promise<{ phonemes: string[]; phonemeIds: number[] }>((resolve, reject) => {
        worker?.terminate();

        worker = new Worker(workerUrl);
        worker.postMessage({
            kind: "phonemize",
            input,
            speakerId: null,
            blobs,
            piperPhonemizeJsUrl,
            piperPhonemizeWasmUrl,
            piperPhonemizeDataUrl,
            modelUrl: null,
            modelConfigUrl,
            onnxruntimeUrl,
        });
        worker.addEventListener("message", (event) => {
            const data = event.data;
            switch (data.kind) {
                case "output": {
                    const phonemes = data.phonemes;
                    const phonemeIds = data.phonemeIds;
                    resolve({ phonemes, phonemeIds });
                    break;
                }
                case "stderr": {
                    reject(data.message);
                    break;
                }
                case "fetch": {
                    if (data.blob) blobs[data.url] = data.blob;
                    const progress = data.blob
                        ? 1
                        : data.total
                            ? data.loaded / data.total
                            : 0;
                    onProgress(Math.round(progress * 100));
                    break;
                }
            }
        });
    });
    return piperPromise;
};
