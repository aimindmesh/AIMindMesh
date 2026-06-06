/**
 * Onboarding Wizard Component
 * 
 * 6-step guided wizard for new users, shown on first launch:
 *   1. Welcome — Introduction to AI Mind Mesh
 *   2. AI Mode — Choose between Local-first or Cloud
 *   3. Model/Key Setup — Configure LLM provider
 *   4. Voice — Set up STT/TTS preferences
 *   5. Privacy — Data sovereignty + permissions overview
 *   6. Ready — All set, launch app
 * 
 * Skip option available for advanced users.
 * Shows only once per version (tracked via localStorage flag).
 */

import React, { useState, useCallback, useEffect } from 'react';

// ─── Constants ───────────────────────────────────────────

const ONBOARDING_VERSION = 1;
const STORAGE_KEY = `onboarding_completed_v${ONBOARDING_VERSION}`;

// ─── Types ───────────────────────────────────────────────

interface OnboardingStep {
    id: string;
    title: string;
    icon: string;
    content: React.ReactNode;
}

interface OnboardingWizardProps {
    onComplete: () => void;
}

// ─── Hook: Should Show Onboarding ────────────────────────

export function useOnboardingShouldShow(): boolean {
    try {
        return !localStorage.getItem(STORAGE_KEY);
    } catch {
        return true;
    }
}

function markOnboardingComplete(): void {
    try {
        localStorage.setItem(STORAGE_KEY, Date.now().toString());
    } catch {
        // localStorage may be unavailable
    }
}

// ─── Step Components ─────────────────────────────────────

function StepWelcome() {
    return (
        <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '64px', marginBottom: '24px' }}>🤖</div>
            <h2 style={{ color: 'var(--color-text-primary)', fontFamily: 'Outfit, sans-serif', fontSize: '28px', marginBottom: '12px' }}>
                Welcome to AI Mind Mesh
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '16px', lineHeight: '1.6', maxWidth: '420px', margin: '0 auto' }}>
                Your personal, private AI assistant that runs primarily on your device.
                Let's get you set up in just a few steps.
            </p>
        </div>
    );
}

function StepAIMode() {
    return (
        <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>🧠</div>
            <h2 style={{ color: 'var(--color-text-primary)', fontFamily: 'Outfit, sans-serif', fontSize: '24px', marginBottom: '12px' }}>
                Choose Your AI Mode
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: '1.6', marginBottom: '24px' }}>
                You can change this anytime in Settings.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '380px', margin: '0 auto' }}>
                <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--color-surface)', border: '1px solid var(--color-primary)', textAlign: 'left' }}>
                    <strong style={{ color: 'var(--color-primary)' }}>🔒 Local-First (Recommended)</strong>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: '8px 0 0' }}>
                        Run AI models directly on your device. Maximum privacy — zero data leaves your phone.
                    </p>
                </div>
                <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--color-surface)', border: '1px solid transparent', textAlign: 'left' }}>
                    <strong style={{ color: 'var(--color-text-primary)' }}>☁️ Cloud-Enhanced</strong>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', margin: '8px 0 0' }}>
                        Use cloud providers (Gemini, Claude) for faster, more capable responses. Requires API key.
                    </p>
                </div>
            </div>
        </div>
    );
}

function StepServerSetup() {
    const [enabled, setEnabled] = useState(false);
    const [serverUrl, setServerUrl] = useState('');
    const [apiKey, setApiKey] = useState('');

    useEffect(() => {
        try {
            const raw = localStorage.getItem('aimindmesh-server-settings');
            if (raw) {
                const s = JSON.parse(raw);
                setEnabled(s.enabled || false);
                setServerUrl(s.serverUrl || '');
                setApiKey(s.apiKey || '');
            }
        } catch { }
    }, []);

    const save = (field: string, value: any) => {
        try {
            const raw = localStorage.getItem('aimindmesh-server-settings');
            const s = raw ? JSON.parse(raw) : { enabled: false, serverUrl: '', apiKey: '' };
            const next = { ...s, [field]: value };
            localStorage.setItem('aimindmesh-server-settings', JSON.stringify(next));
        } catch { }
    };

    return (
        <div style={{ textAlign: 'center', width: '100%', maxWidth: '380px' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>🖥️</div>
            <h2 style={{ color: 'var(--color-text-primary)', fontFamily: 'Outfit, sans-serif', fontSize: '24px', marginBottom: '12px' }}>
                AIMindMesh Server
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: '1.6', marginBottom: '24px' }}>
                Optional: Connect to a self-hosted central hub for distributed intelligence, RAG extraction, and persistent memory.
            </p>
            
            <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--color-surface)', border: '1px solid var(--color-primary)', textAlign: 'left', marginBottom: '16px' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                    <input 
                        type="checkbox" 
                        checked={enabled} 
                        onChange={e => { setEnabled(e.target.checked); save('enabled', e.target.checked); }}
                        style={{ width: '18px', height: '18px', accentColor: 'var(--color-primary)' }}
                    />
                    <strong style={{ color: 'var(--color-text-primary)', fontSize: '15px' }}>Enable Server Hub</strong>
                </label>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', opacity: enabled ? 1 : 0.5, pointerEvents: enabled ? 'auto' : 'none', transition: 'opacity 0.2s', textAlign: 'left' }}>
                <input
                    type="url"
                    placeholder="Server IP (e.g. http://10.2.0.1:3030)"
                    value={serverUrl}
                    onChange={e => { setServerUrl(e.target.value); save('serverUrl', e.target.value); }}
                    style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '14px', outline: 'none' }}
                />
                <input
                    type="password"
                    placeholder="API Key"
                    value={apiKey}
                    onChange={e => { setApiKey(e.target.value); save('apiKey', e.target.value); }}
                    style={{ width: '100%', padding: '12px 16px', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.2)', color: '#fff', fontSize: '14px', outline: 'none' }}
                />
            </div>
        </div>
    );
}

function StepModelSetup() {
    return (
        <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>⚙️</div>
            <h2 style={{ color: 'var(--color-text-primary)', fontFamily: 'Outfit, sans-serif', fontSize: '24px', marginBottom: '12px' }}>
                Model Setup
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: '1.6', maxWidth: '400px', margin: '0 auto 16px' }}>
                Configure your AI model in Settings → LLM after completing setup.
                You can use local GGUF models, LiteRT, or cloud providers.
            </p>
            <div style={{ padding: '16px', borderRadius: '12px', background: 'var(--color-surface)', maxWidth: '380px', margin: '0 auto', textAlign: 'left' }}>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '13px', lineHeight: '1.5' }}>
                    <strong style={{ color: 'var(--color-primary)' }}>Supported providers:</strong><br />
                    • GGUF models (SmolLM, Gemma, Qwen) — fully offline<br />
                    • AIMindMesh Server — your personal powerful hub<br />
                    • LiteRT — optimized for mobile<br />
                    • Cloud Providers — Gemini, Claude, Perplexity
                </p>
            </div>
        </div>
    );
}

function StepVoice() {
    return (
        <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>🎙️</div>
            <h2 style={{ color: 'var(--color-text-primary)', fontFamily: 'Outfit, sans-serif', fontSize: '24px', marginBottom: '12px' }}>
                Voice & Speech
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: '1.6', maxWidth: '400px', margin: '0 auto 16px' }}>
                AI Mind Mesh supports both voice input and output,
                including offline speech recognition and text-to-speech.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '350px', margin: '0 auto', textAlign: 'left' }}>
                <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                    🎤 <strong>Speech-to-Text:</strong> Vosk (offline), Whisper, Voxtral
                </div>
                <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                    🔊 <strong>Text-to-Speech:</strong> Piper (offline), System TTS
                </div>
                <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                    📝 <strong>Meeting Mode:</strong> Live transcription with speaker diarization
                </div>
            </div>
        </div>
    );
}

function StepPrivacy() {
    return (
        <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '48px', marginBottom: '20px' }}>🛡️</div>
            <h2 style={{ color: 'var(--color-text-primary)', fontFamily: 'Outfit, sans-serif', fontSize: '24px', marginBottom: '12px' }}>
                Privacy & Data
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '14px', lineHeight: '1.6', maxWidth: '420px', margin: '0 auto 16px' }}>
                AI Mind Mesh is designed with privacy at its core.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', maxWidth: '380px', margin: '0 auto', textAlign: 'left' }}>
                <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                    🔐 <strong>API keys</strong> encrypted with Android Keystore (AES-256-GCM)
                </div>
                <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                    💾 <strong>All data</strong> stored locally in app-private storage
                </div>
                <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                    🌐 <strong>Cloud is optional</strong> — local-only mode sends zero data
                </div>
                <div style={{ padding: '12px 16px', borderRadius: '10px', background: 'var(--color-surface)', color: 'var(--color-text-secondary)', fontSize: '13px' }}>
                    🗑️ <strong>Full control</strong> — delete memories, chats, recordings anytime
                </div>
            </div>
        </div>
    );
}

function StepReady() {
    return (
        <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '64px', marginBottom: '24px' }}>🚀</div>
            <h2 style={{ color: 'var(--color-text-primary)', fontFamily: 'Outfit, sans-serif', fontSize: '28px', marginBottom: '12px' }}>
                You're All Set!
            </h2>
            <p style={{ color: 'var(--color-text-secondary)', fontSize: '16px', lineHeight: '1.6', maxWidth: '400px', margin: '0 auto' }}>
                Your AI Mind Mesh is ready. You can customize everything in Settings.
                Start chatting or explore the features!
            </p>
        </div>
    );
}

// ─── Main Component ──────────────────────────────────────

const STEPS: OnboardingStep[] = [
    { id: 'welcome', title: 'Welcome', icon: '👋', content: <StepWelcome /> },
    { id: 'ai-mode', title: 'AI Mode', icon: '🧠', content: <StepAIMode /> },
    { id: 'server', title: 'Server', icon: '🖥️', content: <StepServerSetup /> },
    { id: 'model', title: 'Setup', icon: '⚙️', content: <StepModelSetup /> },
    { id: 'voice', title: 'Voice', icon: '🎙️', content: <StepVoice /> },
    { id: 'privacy', title: 'Privacy', icon: '🛡️', content: <StepPrivacy /> },
    { id: 'ready', title: 'Ready', icon: '🚀', content: <StepReady /> },
];

export const OnboardingWizard: React.FC<OnboardingWizardProps> = ({ onComplete }) => {
    const [currentStep, setCurrentStep] = useState(0);
    const isLastStep = currentStep === STEPS.length - 1;

    const handleNext = useCallback(() => {
        if (isLastStep) {
            markOnboardingComplete();
            onComplete();
        } else {
            setCurrentStep(prev => prev + 1);
        }
    }, [isLastStep, onComplete]);

    const handleBack = useCallback(() => {
        setCurrentStep(prev => Math.max(0, prev - 1));
    }, []);

    const handleSkip = useCallback(() => {
        markOnboardingComplete();
        onComplete();
    }, [onComplete]);

    return (
        <div style={{
            position: 'fixed',
            inset: 0,
            zIndex: 9999,
            background: 'var(--color-background)',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: 'Inter, sans-serif',
        }}>
            {/* Skip button */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '16px 20px 0' }}>
                <button
                    onClick={handleSkip}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: 'var(--color-text-secondary)',
                        fontSize: '14px',
                        cursor: 'pointer',
                        padding: '8px 12px',
                    }}
                >
                    Skip
                </button>
            </div>

            {/* Step indicators */}
            <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', padding: '8px 0 24px' }}>
                {STEPS.map((step, idx) => (
                    <div
                        key={step.id}
                        style={{
                            width: idx === currentStep ? '24px' : '8px',
                            height: '8px',
                            borderRadius: '4px',
                            background: idx === currentStep
                                ? 'var(--color-primary)'
                                : idx < currentStep
                                    ? 'var(--color-primary)'
                                    : 'var(--color-surface)',
                            opacity: idx < currentStep ? 0.5 : 1,
                            transition: 'all 0.3s ease',
                        }}
                    />
                ))}
            </div>

            {/* Step content */}
            <div style={{
                flex: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '0 24px',
                overflow: 'auto',
            }}>
                {STEPS[currentStep].content}
            </div>

            {/* Navigation buttons */}
            <div style={{
                display: 'flex',
                gap: '12px',
                padding: '20px 24px',
                paddingBottom: 'calc(20px + env(safe-area-inset-bottom))',
            }}>
                {currentStep > 0 && (
                    <button
                        onClick={handleBack}
                        style={{
                            flex: 1,
                            padding: '14px',
                            borderRadius: '12px',
                            background: 'var(--color-surface)',
                            color: 'var(--color-text-primary)',
                            border: 'none',
                            fontSize: '16px',
                            fontWeight: 600,
                            cursor: 'pointer',
                        }}
                    >
                        Back
                    </button>
                )}
                <button
                    onClick={handleNext}
                    style={{
                        flex: currentStep === 0 ? 1 : 2,
                        padding: '14px',
                        borderRadius: '12px',
                        background: 'linear-gradient(135deg, var(--color-primary), var(--color-secondary))',
                        color: '#fff',
                        border: 'none',
                        fontSize: '16px',
                        fontWeight: 600,
                        cursor: 'pointer',
                        boxShadow: '0 4px 15px rgba(124, 58, 237, 0.3)',
                    }}
                >
                    {isLastStep ? "Let's Go!" : 'Next'}
                </button>
            </div>
        </div>
    );
};
