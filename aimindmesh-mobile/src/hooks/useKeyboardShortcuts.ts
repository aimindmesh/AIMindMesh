import { useEffect } from 'react';
import { isDesktop } from '../utils/platform';
// import { useNavigate } from 'react-router-dom';

/**
 * Hook to handle global keyboard shortcuts.
 * - Ctrl/Cmd + , : Open Settings
 * - Esc : Navigate Back (handled locally, but global fallback here?)
 */
export function useKeyboardShortcuts(
    openSettings: () => void,
    toggleSidebar?: () => void
) {
    // const navigate = useNavigate();

    useEffect(() => {
        if (!isDesktop()) return;

        const handleKeyDown = (e: KeyboardEvent) => {
            // Settings: Ctrl + , or Cmd + ,
            if ((e.ctrlKey || e.metaKey) && e.key === ',') {
                e.preventDefault();
                openSettings();
            }

            // Toggle Sidebar: Ctrl + b (VS Code style) or Ctrl + /
            if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
                e.preventDefault();
                toggleSidebar?.();
            }

            // Developer Tools: F12 (usually handled by browser/webview, but ensuring)
            if (e.key === 'F12') {
                // Let it bubble
            }

            // Back navigation is handled in App.tsx typically, 
            // but we can add more specific ones here if needed.
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [openSettings, toggleSidebar]);
}
