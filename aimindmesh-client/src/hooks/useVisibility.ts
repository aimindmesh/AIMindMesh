import { useState, useEffect } from 'react';

/**
 * Hook to track tab/window visibility and focus.
 * Useful for throttling polling or pausing animations 
 * to save resources when the application is not being actively used.
 */
export function useVisibility() {
  const [isDocumentVisible, setIsDocumentVisible] = useState(!document.hidden);
  const [isFocused, setIsFocused] = useState(document.hasFocus());

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsDocumentVisible(!document.hidden);
    };

    const handleFocus = () => setIsFocused(true);
    const handleBlur = () => setIsFocused(false);

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('focus', handleFocus);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('focus', handleFocus);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  return { 
    isVisible: isDocumentVisible, // Legacy alias
    isDocumentVisible,
    isFocused,
    isActive: isDocumentVisible && isFocused 
  };
}
