import { GoogleGenAI } from '@google/genai';

let client: GoogleGenAI | null = null;

export function getGemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not configured.');
  if (!client) client = new GoogleGenAI({ apiKey });
  return client;
}

export const GEMINI_VISION_MODEL = process.env.GEMINI_VISION_MODEL || 'gemini-3.1-flash-lite';
