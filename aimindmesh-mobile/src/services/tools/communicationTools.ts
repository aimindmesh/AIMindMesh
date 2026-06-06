/**
 * Communication Tool Implementations
 */

import { executeTermuxCommand } from '../termuxPlugin';
import { ToolResult } from './types';

export async function executeSendWhatsApp(args: Record<string, unknown>): Promise<ToolResult> {
    const phoneNumber = args.phone_number as string;
    const message = args.message as string;

    if (!phoneNumber || !message) {
        return { success: false, message: 'Phone number and message are required' };
    }

    // Clean phone number (remove spaces, dashes, etc.)
    const cleanPhone = phoneNumber.replace(/[^0-9+]/g, '');
    const encodedMessage = encodeURIComponent(message);

    // WhatsApp uses wa.me URL scheme
    const url = `https://wa.me/${cleanPhone}?text=${encodedMessage}`;
    const cmd = `am start -a android.intent.action.VIEW -d "${url}"`;

    const result = await executeTermuxCommand(cmd);

    if (result.success || result.exitCode === 0) {
        return {
            success: true,
            message: `Opening WhatsApp to send message to ${phoneNumber}`,
            data: { phoneNumber, message }
        };
    } else {
        return {
            success: false,
            message: `Failed to open WhatsApp: ${result.stderr || 'WhatsApp may not be installed'}`
        };
    }
}

export async function executeSendTelegram(args: Record<string, unknown>): Promise<ToolResult> {
    const username = args.username as string;
    const message = args.message as string;

    if (!message) {
        return { success: false, message: 'Message is required' };
    }

    const encodedMessage = encodeURIComponent(message);
    let url: string;

    if (username) {
        // Send to specific user
        url = `tg://msg?to=${username}&text=${encodedMessage}`;
    } else {
        // Just open Telegram with the message (user selects recipient)
        url = `tg://msg?text=${encodedMessage}`;
    }

    const cmd = `am start -a android.intent.action.VIEW -d "${url}"`;
    const result = await executeTermuxCommand(cmd);

    if (result.success || result.exitCode === 0) {
        return {
            success: true,
            message: username
                ? `Opening Telegram to message ${username}`
                : `Opening Telegram with message`,
            data: { username, message }
        };
    } else {
        return {
            success: false,
            message: `Failed to open Telegram: ${result.stderr || 'Telegram may not be installed'}`
        };
    }
}

export async function executeGetContacts(args: Record<string, unknown>): Promise<ToolResult> {
    const name = args.name as string;

    if (!name) {
        return { success: false, message: 'Contact name is required' };
    }

    // Use termux-contact-list and grep
    const cmd = `termux-contact-list | grep -i '${name.replace(/'/g, "'\\''")}'`;
    const result = await executeTermuxCommand(cmd);

    if (result.success && result.stdout) {
        try {
            // termux-contact-list returns JSON array
            const contacts = JSON.parse(`[${result.stdout.split('\n').filter(l => l.trim()).join(',')}]`);
            const formatted = contacts.map((c: any) => `${c.name}: ${c.number}`).join('\n');

            return {
                success: true,
                message: `Found contacts:\n${formatted}`,
                data: { contacts, query: name }
            };
        } catch {
            // Fallback to raw output if JSON parsing fails
            return {
                success: true,
                message: `Contact search results:\n${result.stdout}`,
                data: { raw: result.stdout, query: name }
            };
        }
    } else {
        return {
            success: false,
            message: `No contacts found matching "${name}"`,
            data: { query: name }
        };
    }
}
