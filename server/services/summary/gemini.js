import { GoogleGenerativeAI } from '@google/generative-ai';

export async function summarizeWithGemini(text, systemPrompt, options = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY が設定されていません');
  }

  const model = options.model || 'gemini-3.1-flash-lite-preview';
  const genAI = new GoogleGenerativeAI(apiKey);
  const genModel = genAI.getGenerativeModel({
    model,
    systemInstruction: systemPrompt,
  });

  const result = await genModel.generateContent(text);
  const response = result.response;
  return response.text();
}
