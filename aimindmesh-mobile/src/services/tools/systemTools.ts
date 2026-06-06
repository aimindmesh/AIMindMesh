import { Type } from '@google/genai';
import { ToolDefinition, ToolResult } from './types';
import { executeTermuxCommand } from '../termuxPlugin';
import { Clipboard } from '@capacitor/clipboard';

// Re-export definitions
export const systemTools: ToolDefinition[] = [
    // Termux
    {
        name: 'run_termux_command',
        description: 'Executes a shell command via Termux. Use for system operations, file management, or running scripts. Requires Termux:API to be installed.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                command: {
                    type: Type.STRING,
                    description: 'The shell command to execute (e.g., "ls -la", "pwd", "cat file.txt")'
                },
                background: {
                    type: Type.BOOLEAN,
                    description: 'Run command in background without waiting for output. Default is false.'
                }
            },
            required: ['command']
        },
        requiresConfirmation: true,
        category: 'system'
    },
    {
        name: 'get_clipboard',
        description: 'Gets the current content of the device clipboard via Termux:API.',
        parameters: {
            type: Type.OBJECT,
            properties: {},
            required: []
        },
        requiresConfirmation: false,
        category: 'system'
    },
    {
        name: 'set_clipboard',
        description: 'Sets the device clipboard content via Termux:API.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                text: {
                    type: Type.STRING,
                    description: 'The text to copy to the clipboard'
                }
            },
            required: ['text']
        },
        requiresConfirmation: false,
        category: 'system'
    },
    {
        name: 'get_battery_status',
        description: 'Gets battery information (level, charging status, temperature) via Termux:API.',
        parameters: {
            type: Type.OBJECT,
            properties: {},
            required: []
        },
        requiresConfirmation: false,
        category: 'system'
    },
    {
        name: 'termux_speak',
        description: 'Speaks text aloud using the device TTS engine via Termux:API.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                text: {
                    type: Type.STRING,
                    description: 'The text to speak'
                }
            },
            required: ['text']
        },
        requiresConfirmation: false,
        category: 'system'
    },
    {
        name: 'termux_notification',
        description: 'Shows a notification on the device via Termux:API.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                title: {
                    type: Type.STRING,
                    description: 'Notification title'
                },
                content: {
                    type: Type.STRING,
                    description: 'Notification body text'
                },
                id: {
                    type: Type.STRING,
                    description: 'Optional notification ID for updating existing notifications'
                }
            },
            required: ['title', 'content']
        },
        requiresConfirmation: false,
        category: 'system'
    },
    {
        name: 'termux_vibrate',
        description: 'Vibrates the device via Termux:API.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                duration: {
                    type: Type.NUMBER,
                    description: 'Vibration duration in milliseconds (default: 500)'
                }
            },
            required: []
        },
        requiresConfirmation: false,
        category: 'system'
    },
    {
        name: "termux_install_pkg",
        description: "Install a package in Termux. Usage example: termux_install_pkg({package: 'python'})",
        parameters: {
            type: Type.OBJECT,
            properties: {
                package: { type: Type.STRING, description: "Name of the package to install" }
            },
            required: ['package']
        },
        requiresConfirmation: false,
        category: 'system'
    },
    {
        name: "termux_install_ubuntu",
        description: "AUTOMATED script to install Ubuntu Linux in Termux. Use this when user asks to 'install ubuntu' or 'setup linux'. It handles all steps automatically.",
        parameters: {
            type: Type.OBJECT,
            properties: {
                // No parameters needed
            },
            required: []
        },
        requiresConfirmation: true,
        category: 'system'
    },

    // Apps & Device
    {
        name: 'launch_app',
        description: 'Opens an installed app on the device. Use the app name or package name.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                app_name: {
                    type: Type.STRING,
                    description: 'Name of the app to open (e.g., "YouTube", "Spotify", "Settings")'
                },
                package_name: {
                    type: Type.STRING,
                    description: 'Optional: Android package name (e.g., "com.google.android.youtube")'
                }
            },
            required: ['app_name']
        },
        requiresConfirmation: true,
        category: 'system'
    },
    {
        name: 'get_contacts',
        description: 'Searches the device contacts for a name and returns phone numbers.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                name: {
                    type: Type.STRING,
                    description: 'Name to search for in contacts'
                }
            },
            required: ['name']
        },
        requiresConfirmation: false,
        category: 'system'
    },
    {
        name: 'set_volume',
        description: 'Sets the device volume for a specific stream.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                stream: {
                    type: Type.STRING,
                    description: 'Audio stream to control',
                    enum: ['music', 'ring', 'alarm', 'notification']
                },
                level: {
                    type: Type.NUMBER,
                    description: 'Volume level (0-15 typically)'
                }
            },
            required: ['stream', 'level']
        },
        requiresConfirmation: false,
        category: 'system'
    },
    {
        name: 'set_brightness',
        description: 'Sets the screen brightness level.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                level: {
                    type: Type.NUMBER,
                    description: 'Brightness level (0-255)'
                }
            },
            required: ['level']
        },
        requiresConfirmation: false,
        category: 'system'
    },
    {
        name: 'toggle_wifi',
        description: 'Enables or disables WiFi.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                enabled: {
                    type: Type.BOOLEAN,
                    description: 'True to enable WiFi, false to disable'
                }
            },
            required: ['enabled']
        },
        requiresConfirmation: true,
        category: 'system'
    },
    {
        name: 'get_location',
        description: 'Gets the current GPS location of the device.',
        parameters: {
            type: Type.OBJECT,
            properties: {
                provider: {
                    type: Type.STRING,
                    description: 'Location provider to use',
                    enum: ['gps', 'network', 'passive']
                }
            },
            required: []
        },
        requiresConfirmation: false,
        category: 'system'
    }
];

export async function executeRunTermuxCommand(args: Record<string, unknown>): Promise<ToolResult> {
    const command = args.command as string;
    const background = args.background as boolean;

    if (!command) {
        return { success: false, message: 'Command is required' };
    }

    const result = await executeTermuxCommand(command, background);

    if (result.success || result.exitCode === 0) {
        return {
            success: true,
            message: `Command executed successfully`,
            data: { stdout: result.stdout, stderr: result.stderr }
        };
    } else {
        return {
            success: false,
            message: `Command failed: ${result.stderr || result.stdout || 'Unknown error'}`
        };
    }
}

export async function executeGetClipboard(): Promise<ToolResult> {
    try {
        const { value } = await Clipboard.read();
        return { success: true, message: "Clipboard read", data: { text: value } };
    } catch (e: any) {
        // Fallback to Termux
        const result = await executeTermuxCommand('termux-clipboard-get');
        if (result.success) {
            return { success: true, message: "Clipboard read (Termux)", data: { text: result.stdout } };
        }
        return { success: false, message: "Failed to read clipboard" };
    }
}

export async function executeSetClipboard(args: { text: string }): Promise<ToolResult> {
    try {
        await Clipboard.write({ string: args.text });
        return { success: true, message: "Clipboard set" };
    } catch (e: any) {
        // Fallback to Termux
        const cleanText = args.text.replace(/'/g, "'\\''");
        await executeTermuxCommand(`termux-clipboard-set '${cleanText}'`);
        return { success: true, message: "Clipboard set (Termux)" };
    }
}

export async function executeGetBatteryStatus(): Promise<ToolResult> {
    // Try Termux only as Device plugin is missing
    try {
        const result = await executeTermuxCommand('termux-battery-status');
        if (result.success) {
            return { success: true, message: "Battery status retrieved", data: JSON.parse(result.stdout || '{}') };
        }
        return { success: false, message: "Failed to get battery status (Termux failed)" };
    } catch (e: any) {
        return { success: false, message: "Failed to get battery status: " + e.message };
    }
}

export async function executeTermuxSpeak(args: { text: string }): Promise<ToolResult> {
    try {
        const cleanText = args.text.replace(/'/g, "'\\''");
        await executeTermuxCommand(`termux-tts-speak '${cleanText}'`);
        return { success: true, message: "Spoken (Termux)" };
    } catch (e: any) {
        return { success: false, message: "Failed to speak: " + e.message };
    }
}

export async function executeTermuxNotification(args: { title: string; content: string; id?: string }): Promise<ToolResult> {
    const cmd = `termux-notification -t '${args.title}' -c '${args.content}' ${args.id ? `--id ${args.id}` : ''}`;
    await executeTermuxCommand(cmd);
    return { success: true, message: "Notification shown" };
}

export async function executeTermuxVibrate(args: { duration?: number }): Promise<ToolResult> {
    const duration = args.duration || 500;
    await executeTermuxCommand(`termux-vibrate -d ${duration}`);
    return { success: true, message: "Vibrated" };
}

export async function installTermuxPackage(args: { package: string }): Promise<ToolResult> {
    const cmd = `pkg install -y ${args.package}`;
    const result = await executeTermuxCommand(cmd);
    return {
        success: result.success,
        message: result.success ? `Installed ${args.package}` : `Failed to install ${args.package}`
    };
}

export async function installTermuxUbuntu(): Promise<ToolResult> {
    const cmd = 'pkg install -y proot-distro && proot-distro install ubuntu';
    const result = await executeTermuxCommand(cmd);
    return {
        success: result.success,
        message: result.success ? "Ubuntu installed" : "Failed to install Ubuntu"
    };
}
