import { useState, useEffect, useCallback, useRef } from 'react';
import { getWakeWordService, WakeWordConfig, WakeWordDetection, WakeWordModelInfo } from '../services/wakeword';
import { triggerHaptic } from '../services/native';
import { logger } from '../services/logger';

/**
 * Configuration options for the useWakeWord hook
 */
export interface UseWakeWordOptions {
    /** Enable/disable wake word detection */
    enabled: boolean;
    /** Wake word model to use */
    modelName: string;
    /** Detection threshold (0.0 - 1.0) */
    threshold?: number;
    /** Cooldown between detections in ms */
    cooldownMs?: number;
    /** Buffer size in chunks */
    bufferSize?: number;
    /** Callback when wake word is detected */
    onWakeWordDetected?: (detection: WakeWordDetection) => void;
    /** Enable haptic feedback on detection */
    hapticFeedback?: boolean;
    /** Enable debug mode */
    debug?: boolean;
}

/**
 * Return type for the useWakeWord hook
 */
export interface UseWakeWordResult {
    /** Whether the service is initialized and ready */
    isInitialized: boolean;
    /** Whether models are loaded */
    isModelLoaded: boolean;
    /** Whether currently listening for wake word */
    isListening: boolean;
    /** Whether the service is currently loading */
    isLoading: boolean;
    /** Current audio level (0.0 - 1.0) for visualization */
    audioLevel: number;
    /** Last detection event */
    lastDetection: WakeWordDetection | null;
    /** Any error that occurred */
    error: string | null;
    /** Available wake word models */
    availableModels: WakeWordModelInfo[];
    /** Start listening for wake word */
    startListening: () => Promise<boolean>;
    /** Stop listening for wake word */
    stopListening: () => Promise<void>;
    /** Toggle listening state */
    toggleListening: () => Promise<void>;
    /** Reload the model with new config */
    reloadModel: (config?: Partial<WakeWordConfig>) => Promise<boolean>;
    /** Update threshold */
    setThreshold: (threshold: number) => Promise<void>;
    /** Update cooldown */
    setCooldown: (cooldownMs: number) => Promise<void>;
    /** Update buffer size */
    setBufferSize: (bufferSize: number) => Promise<void>;
    /** Check if base models are present */
    checkBaseModels: () => Promise<{ hasMelSpectrogram: boolean; hasEmbedding: boolean }>;
}

/**
 * React hook for wake word detection
 * 
 * @example
 * ```tsx
 * const { isListening, startListening, stopListening } = useWakeWord({
 *   enabled: true,
 *   modelName: 'hey_jarvis_v0.1.tflite',
 *   threshold: 0.5,
 *   onWakeWordDetected: (detection) => {
 *     console.log('Wake word detected!', detection);
 *     // Activate voice mode, etc.
 *   }
 * });
 * ```
 */
export function useWakeWord(options: UseWakeWordOptions): UseWakeWordResult {
    const {
        enabled,
        modelName,
        threshold = 0.5,
        cooldownMs = 2000,
        bufferSize = 20,
        onWakeWordDetected,
        hapticFeedback = true,
        debug = false,
    } = options;
    
    // State
    const [isInitialized, setIsInitialized] = useState(false);
    const [isModelLoaded, setIsModelLoaded] = useState(false);
    const [isListening, setIsListening] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [audioLevel, setAudioLevel] = useState(0);
    const [lastDetection, setLastDetection] = useState<WakeWordDetection | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [availableModels, setAvailableModels] = useState<WakeWordModelInfo[]>([]);
    
    // Refs for callbacks (to avoid stale closures)
    const onWakeWordDetectedRef = useRef(onWakeWordDetected);
    onWakeWordDetectedRef.current = onWakeWordDetected;
    
    // Service ref
    const serviceRef = useRef(getWakeWordService());
    
    // Cleanup refs for listeners
    const cleanupRef = useRef<(() => void)[]>([]);
    
    /**
     * Initialize the service and load models
     */
    const initialize = useCallback(async () => {
        const service = serviceRef.current;
        
        setIsLoading(true);
        setError(null);
        
        try {
            // Check if plugin is available
            const available = await service.ensureAvailable();
            if (!available) {
                setError('Wake word plugin not available');
                setIsLoading(false);
                return false;
            }
            
            // Setup event listeners
            const unsubDetection = service.onDetection((detection) => {
                logger.log('info', `Wake word detected: ${detection.wakeWord}`);
                setLastDetection(detection);
                
                if (hapticFeedback) {
                    triggerHaptic('HEAVY');
                }
                
                onWakeWordDetectedRef.current?.(detection);
            });
            
            const unsubState = service.onStateChange((listening) => {
                setIsListening(listening);
            });
            
            const unsubLevel = service.onAudioLevel((level) => {
                setAudioLevel(level);
            });
            
            const unsubError = service.onError((err, code) => {
                logger.log('error', `Wake word error: ${err} (${code})`);
                setError(err);
            });
            
            cleanupRef.current = [unsubDetection, unsubState, unsubLevel, unsubError];
            
            // Load available models
            const models = await service.getAvailableModels();
            setAvailableModels(models);
            
            // Load the specified model
            const loaded = await service.loadModel({
                modelName,
                threshold,
                cooldownMs,
                bufferSize,
                debug,
            });
            
            setIsModelLoaded(loaded);
            setIsInitialized(true);
            
            if (!loaded) {
                setError('Failed to load wake word model. Ensure all required models are present.');
            }
            
            setIsLoading(false);
            return loaded;
            
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Unknown error';
            logger.log('error', 'Wake word initialization failed', err);
            setError(message);
            setIsLoading(false);
            return false;
        }
    }, [modelName, threshold, cooldownMs, bufferSize, debug, hapticFeedback]);
    
    /**
     * Start listening for wake word
     */
    const startListening = useCallback(async (): Promise<boolean> => {
        const service = serviceRef.current;
        
        if (!isModelLoaded) {
            setError('Model not loaded');
            return false;
        }
        
        try {
            setError(null);
            const success = await service.startListening();
            return success;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to start listening';
            setError(message);
            return false;
        }
    }, [isModelLoaded]);
    
    /**
     * Stop listening for wake word
     */
    const stopListening = useCallback(async (): Promise<void> => {
        const service = serviceRef.current;
        
        try {
            await service.stopListening();
            setAudioLevel(0);
        } catch (err) {
            logger.log('error', 'Failed to stop listening', err);
        }
    }, []);
    
    /**
     * Toggle listening state
     */
    const toggleListening = useCallback(async (): Promise<void> => {
        if (isListening) {
            await stopListening();
        } else {
            await startListening();
        }
    }, [isListening, startListening, stopListening]);
    
    /**
     * Reload model with new configuration
     */
    const reloadModel = useCallback(async (config?: Partial<WakeWordConfig>): Promise<boolean> => {
        const service = serviceRef.current;
        
        setIsLoading(true);
        setError(null);
        
        try {
            // Stop listening first
            await service.stopListening();
            
            // Reload model
            const loaded = await service.loadModel({
                modelName: config?.modelName || modelName,
                threshold: config?.threshold || threshold,
                cooldownMs: config?.cooldownMs || cooldownMs,
                bufferSize: config?.bufferSize || bufferSize,
                debug: config?.debug || debug,
            });
            
            setIsModelLoaded(loaded);
            setIsLoading(false);
            
            if (!loaded) {
                setError('Failed to reload model');
            }
            
            return loaded;
            
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to reload model';
            setError(message);
            setIsLoading(false);
            return false;
        }
    }, [modelName, threshold, cooldownMs, bufferSize, debug]);
    
    /**
     * Update threshold
     */
    const setThreshold = useCallback(async (newThreshold: number): Promise<void> => {
        const service = serviceRef.current;
        await service.setThreshold(newThreshold);
    }, []);
    
    /**
     * Update cooldown
     */
    const setCooldown = useCallback(async (newCooldown: number): Promise<void> => {
        const service = serviceRef.current;
        await service.setCooldown(newCooldown);
    }, []);
    
    /**
     * Update buffer size
     */
    const setBufferSize = useCallback(async (newBufferSize: number): Promise<void> => {
        const service = serviceRef.current;
        await service.setBufferSize(newBufferSize);
    }, []);
    
    /**
     * Check if base models are present
     */
    const checkBaseModels = useCallback(async () => {
        const service = serviceRef.current;
        return service.checkBaseModels();
    }, []);
    
    // Initialize when enabled changes
    useEffect(() => {
        if (enabled && !isInitialized && !isLoading) {
            initialize();
        }
    }, [enabled, isInitialized, isLoading, initialize]);
    
    // Start/stop listening based on enabled state
    useEffect(() => {
        if (!isInitialized || !isModelLoaded) return;
        
        if (enabled && !isListening) {
            startListening();
        } else if (!enabled && isListening) {
            stopListening();
        }
    }, [enabled, isInitialized, isModelLoaded, isListening, startListening, stopListening]);
    
    // Cleanup on unmount
    useEffect(() => {
        return () => {
            // Stop listening
            serviceRef.current.stopListening();
            
            // Remove listeners
            cleanupRef.current.forEach(cleanup => cleanup());
            cleanupRef.current = [];
        };
    }, []);
    
    // Update config when props change
    useEffect(() => {
        if (isModelLoaded) {
            serviceRef.current.setThreshold(threshold);
        }
    }, [threshold, isModelLoaded]);
    
    useEffect(() => {
        if (isModelLoaded) {
            serviceRef.current.setCooldown(cooldownMs);
        }
    }, [cooldownMs, isModelLoaded]);
    
    useEffect(() => {
        if (isModelLoaded) {
            serviceRef.current.setBufferSize(bufferSize);
        }
    }, [bufferSize, isModelLoaded]);
    
    return {
        isInitialized,
        isModelLoaded,
        isListening,
        isLoading,
        audioLevel,
        lastDetection,
        error,
        availableModels,
        startListening,
        stopListening,
        toggleListening,
        reloadModel,
        setThreshold,
        setCooldown,
        setBufferSize,
        checkBaseModels,
    };
}