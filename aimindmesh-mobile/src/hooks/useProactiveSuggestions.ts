
import { useState, useEffect } from 'react';
import { proactiveService } from '../services/proactive/ProactiveService';
import { ProactiveAction } from '../types/proactive';

export function useProactiveSuggestions() {
    const [suggestions, setSuggestions] = useState<ProactiveAction[]>([]);

    useEffect(() => {
        const unsub = proactiveService.subscribe(setSuggestions);
        return unsub;
    }, []);

    return {
        suggestions,
        dismissSuggestion: (id: string) => proactiveService.dismissSuggestion(id),
        acceptSuggestion: (action: ProactiveAction) => proactiveService.acceptSuggestion(action)
    };
}
