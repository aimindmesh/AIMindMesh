/**
 * Kasm Automation Tools for OpenClaw
 * These tools interface with the AICompanion Server to control Kasm Workspaces.
 */

const BASE_URL = 'http://host.docker.internal:3030/api/kasm';
const API_KEY = process.env.AI_COMPANION_API_KEY || 'default_key';

async function callApi(endpoint, method = 'GET', body = null) {
  const url = `${BASE_URL}${endpoint}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': API_KEY
    }
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error (${res.status}): ${errorText}`);
  }
  return res.json();
}

module.exports = [
  {
    name: 'kasm_list_images',
    description: 'List available Kasm workspace images (e.g., Brave, Ubuntu, Kali). Call this to get the correct image_id.',
    parameters: { type: 'object', properties: {} },
    handler: async () => {
      const data = await callApi('/images');
      return data;
    }
  },
  {
    name: 'kasm_create_session',
    description: 'Start a new Kasm workspace session for a specific image.',
    parameters: {
      type: 'object',
      properties: {
        image_id: { type: 'string', description: 'The UUID of the image to spawn (e.g. from kasm_list_images).' }
      },
      required: ['image_id']
    },
    handler: async ({ image_id }) => {
      // The server expects { image_id, user_id } 
      // But user_id is optional and defaults to the configured admin UUID in KasmService
      const data = await callApi('/request', 'POST', { image_id });
      return data;
    }
  },
  {
    name: 'kasm_execute_command',
    description: 'Run a shell command inside an active Kasm workspace session.',
    parameters: {
      type: 'object',
      properties: {
        kasm_id: { type: 'string', description: 'The ID of the active Kasm session.' },
        cmd: { type: 'string', description: 'The shell command to execute (e.g. "ls", "brave-browser https://google.com").' }
      },
      required: ['kasm_id', 'cmd']
    },
    handler: async ({ kasm_id, cmd }) => {
      const data = await callApi('/exec', 'POST', { kasmId: kasm_id, cmd });
      return data;
    }
  },
  {
    name: 'kasm_get_screenshot',
    description: 'Capture a screenshot of an active Kasm workspace. Returns a base64 string.',
    parameters: {
      type: 'object',
      properties: {
        kasm_id: { type: 'string', description: 'The ID of the active Kasm session.' }
      },
      required: ['kasm_id']
    },
    handler: async ({ kasm_id }) => {
      const data = await callApi(`/sessions/${kasm_id}/screenshot`);
      return { 
        message: 'Screenshot captured successfully.',
        screenshot: data.screenshot // Assuming it's base64
      };
    }
  },
  {
    name: 'kasm_destroy_session',
    description: 'Terminate an active Kasm workspace session to free up resources.',
    parameters: {
      type: 'object',
      properties: {
        kasm_id: { type: 'string', description: 'The ID of the session to destroy.' }
      },
      required: ['kasm_id']
    },
    handler: async ({ kasm_id }) => {
      const data = await callApi(`/sessions/${kasm_id}`, 'DELETE');
      return data;
    }
  }
];
