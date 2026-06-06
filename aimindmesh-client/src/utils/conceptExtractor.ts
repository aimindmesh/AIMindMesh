import { serverApi } from '../services/serverApi';
import { Logger } from './logger';

/**
 * Extracts key concepts, entities, or technical terms from text locally using local neural network.
 */
export async function extractConceptsLocally(text: string): Promise<string[]> {
  const prompt = `Extract exactly 5 key concepts, entities, or technical terms from this text. 
  You MUST output ONLY a JSON array of strings. Do not include any explanation or markdown.
  Format: ["Concept1", "Concept2", "Concept3", "Concept4", "Concept5"]
  
  Text: ${text.slice(0, 2000)}`;

  try {
    const res = await serverApi.post('/api/inference/chat', {
      messages: [{ role: 'user', content: prompt }],
      personality: { name: 'Extractor', systemPrompt: 'Return JSON' }
    });
    
    const fullResponse = res.data.response || '';
    const match = fullResponse.match(/\[.*\]/s);
    if (match) {
      const concepts = JSON.parse(match[0]);
      return Array.isArray(concepts) ? concepts.slice(0, 5) : [];
    }
  } catch (e) {
    Logger.warn('ConceptExtractor', `Local extraction failed: ${e}`);
  }
  return [];
}
