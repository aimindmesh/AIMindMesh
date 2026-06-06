import React, { useState, useEffect, useRef } from 'react';
import { getWakeWordService } from '../../../services/wakeword';
import { getCleanModelName } from '../../../utils/stringUtils';

interface WakeWordTestProps {
    modelName: string;
    threshold: number;
    cooldownMs: number;
    bufferSize: number;
    selectedModelDisplayName?: string;
}

export const WakeWordTest: React.FC<WakeWordTestProps> = ({
    modelName,
    threshold,
    cooldownMs,
    bufferSize,
    selectedModelDisplayName
}) => {
    const [isTesting, setIsTesting] = useState(false);
    const isTestingRef = useRef(false);
    const [testResult, setTestResult] = useState<{ detected: boolean; confidence: number; timestamp: number } | null>(null);
    const [testCleanup, setTestCleanup] = useState<(() => void) | null>(null);

    // Sync ref
    useEffect(() => {
        isTestingRef.current = isTesting;
    }, [isTesting]);

    // Clean up on unmount
    useEffect(() => {
        return () => {
            if (testCleanup) testCleanup();
            if (isTestingRef.current) {
                const service = getWakeWordService();
                service.stopListening();
            }
        };
    }, []);

    const handleStartTest = async () => {
        setTestResult(null);
        setIsTesting(true);

        const service = getWakeWordService();

        // Ensure model is loaded with current settings
        const loaded = await service.loadModel({
            modelName: modelName,
            threshold: threshold,
            cooldownMs: cooldownMs,
            bufferSize: bufferSize
        });

        // Race condition check: Did user cancel while loading?
        if (!isTestingRef.current) {
            console.log("Test cancelled during load, aborting start.");
            return;
        }

        if (!loaded) {
            alert("Failed to load model for testing");
            setIsTesting(false);
            return;
        }

        // Subscribe to detection
        const unsubscribe = service.onDetection((event) => {
            if (event.wakeWord === modelName ||
                modelName.includes(event.wakeWord) ||
                event.wakeWord.includes(modelName.replace('custom:', ''))) {

                setTestResult({
                    detected: true,
                    confidence: event.confidence,
                    timestamp: Date.now()
                });
                setIsTesting(false);
                service.stopListening();
            }
        });
        setTestCleanup(() => unsubscribe);

        // Race condition check: Did user cancel while processing?
        if (!isTestingRef.current) {
            console.log("Test cancelled before start, aborting.");
            unsubscribe();
            return;
        }

        // Start listening if not already
        const listening = await service.startListening();

        // Final check
        if (!isTestingRef.current) {
            console.log("Test cancelled during start, stopping immediately.");
            service.stopListening();
            unsubscribe();
            return;
        }

        if (!listening) {
            alert("Failed to start listening");
            setIsTesting(false);
            unsubscribe();
        }
    };

    const handleCancelTest = () => {
        setIsTesting(false);
        // Properly cleanup: stop listening and unsubscribe
        if (testCleanup) testCleanup();
        getWakeWordService().stopListening();
    };

    return (
        <div className="mt-4 border-t border-gray-700 pt-4">
            <h4 className="text-white text-sm font-medium mb-2">Test Recognition</h4>

            {!isTesting ? (
                <button
                    onClick={handleStartTest}
                    className="w-full py-2 px-3 bg-gray-700 hover:bg-gray-600 text-white rounded-lg flex items-center justify-center gap-2 transition-colors"
                >
                    <span>👂</span> Test "{getCleanModelName(selectedModelDisplayName || modelName)}"
                </button>
            ) : (
                <div className="bg-gray-800 rounded-lg p-4 animate-pulse border border-blue-500/50">
                    <div className="flex flex-col items-center gap-2">
                        <div className="w-12 h-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                            <span className="text-2xl animate-bounce">🎤</span>
                        </div>
                        <p className="text-white font-medium">Listening...</p>
                        <p className="text-xs text-gray-400">Say the wake word clearly</p>
                        <button
                            onClick={handleCancelTest}
                            className="mt-2 text-xs text-red-400 hover:text-red-300 underline"
                        >
                            Cancel Test
                        </button>
                    </div>
                </div>
            )}

            {testResult && (
                <div className={`mt-3 p-3 rounded-lg border ${testResult.confidence > 0.6 ? 'bg-green-500/10 border-green-500/30' : 'bg-yellow-500/10 border-yellow-500/30'}`}>
                    <div className="flex items-center gap-2 mb-1">
                        <span className="text-lg">{testResult.confidence > 0.6 ? '✅' : '⚠️'}</span>
                        <span className={`font-medium ${testResult.confidence > 0.6 ? 'text-green-400' : 'text-yellow-400'}`}>
                            Detected!
                        </span>
                    </div>
                    <div className="flex justify-between items-center text-sm">
                        <span className="text-gray-300">Confidence Score:</span>
                        <span className="font-mono text-white">{(testResult.confidence * 100).toFixed(1)}%</span>
                    </div>
                    <div className="w-full bg-gray-700 h-2 rounded-full mt-2 overflow-hidden">
                        <div
                            className={`h-full ${testResult.confidence > 0.7 ? 'bg-green-500' : testResult.confidence > 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                            style={{ width: `${Math.min(testResult.confidence * 100, 100)}%` }}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};
