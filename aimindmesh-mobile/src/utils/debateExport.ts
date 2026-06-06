/**
 * debateExport.ts
 * Utility to format multi-agent debate threads as Markdown.
 */

export interface ExportMessage {
    role: string;
    content: string;
    round?: number;
    timestamp?: number;
    usedNode?: string;
}

export function formatThreadAsMarkdown(title: string, messages: ExportMessage[]): string {
    const header = `# Debate: ${title}\n` +
                 `Generated: ${new Date().toLocaleString()}\n` +
                 `Total Messages: ${messages.length}\n\n` +
                 `---\n\n`;

    const body = messages.map(msg => {
        const role = msg.role.toUpperCase();
        const roleIcon = role === 'ADVOCATE' ? '🛡️ ' :
                        role === 'CRITIC' ? '⚖️ ' :
                        role === 'ORCHESTRATOR' ? '🎯 ' :
                        role === 'HUMAN' || role === 'USER' ? '👤 ' : '';
        
        const roundInfo = msg.round ? ` (Round ${msg.round})` : '';
        const nodeInfo = msg.usedNode ? ` [via ${msg.usedNode}]` : '';
        
        return `### ${roleIcon}${role}${roundInfo}${nodeInfo}\n${msg.content}\n\n---\n`;
    }).join('\n');

    return header + body;
}
