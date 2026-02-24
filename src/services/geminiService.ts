import { GoogleGenAI, Type, Modality, GenerateContentResponse } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || "" });

export interface WordAnalysis {
  word: string;
  meaning: string;
  context_explanation: string;
  phonetic_us: string;
  phonetic_uk: string;
  image_prompt: string;
}

export const analyzeImageContext = async (base64Image: string): Promise<WordAnalysis[]> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            inlineData: {
              mimeType: "image/jpeg",
              data: base64Image.split(",")[1] || base64Image,
            },
          },
          {
            text: "Analyze this screenshot from a video. Perform OCR to find English text. Identify key vocabulary words that might be challenging. For each word, provide: 1. The word itself. 2. Its precise meaning in this specific context. 3. A brief explanation of why it means that here. 4. US Phonetic (KK). 5. UK Phonetic (DJ). 6. A descriptive prompt for a real-world photo of this object/concept.",
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            word: { type: Type.STRING },
            meaning: { type: Type.STRING },
            context_explanation: { type: Type.STRING },
            phonetic_us: { type: Type.STRING },
            phonetic_uk: { type: Type.STRING },
            image_prompt: { type: Type.STRING },
          },
          required: ["word", "meaning", "context_explanation", "phonetic_us", "phonetic_uk", "image_prompt"],
        },
      },
    },
  });

  return JSON.parse(response.text || "[]");
};

export const generateSpeech = async (text: string, accent: 'US' | 'UK'): Promise<string> => {
  const voiceName = accent === 'US' ? 'Zephyr' : 'Kore';
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-preview-tts",
    contents: [{ parts: [{ text }] }],
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: {
        voiceConfig: {
          prebuiltVoiceConfig: { voiceName },
        },
      },
    },
  });

  return response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data || "";
};

export const generateVisualAnchor = async (prompt: string): Promise<string> => {
  const response = await ai.models.generateContent({
    model: "gemini-2.5-flash-image",
    contents: [{ text: `A high-quality, realistic photo of: ${prompt}. Real-world photography style, no text, no cartoons.` }],
  });

  for (const part of response.candidates?.[0]?.content?.parts || []) {
    if (part.inlineData) {
      return `data:image/png;base64,${part.inlineData.data}`;
    }
  }
  return "";
};

export const processVideoUrl = async (url: string): Promise<{time: string, text: string, translation: string}[]> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze this video URL: ${url}. 
    Your goal is to help an English learner understand complex vocabulary and sentence structures from this video.
    
    1. Use Google Search to find the actual content/transcript of the video if possible.
    2. Select 6-8 key segments that contain challenging but useful English expressions.
    3. For each segment, provide the exact English text and a high-quality Chinese translation.
    4. Ensure the timestamps are realistic.
    
    If the video cannot be found, create a highly realistic "educational simulation" of what a high-level English lesson from a video with that title/URL would contain.
    
    Return ONLY a JSON array of objects with 'time', 'text', and 'translation' fields.`,
    config: {
      tools: [{ googleSearch: {} }],
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            time: { type: Type.STRING },
            text: { type: Type.STRING },
            translation: { type: Type.STRING },
          },
          required: ["time", "text", "translation"],
        },
      },
    },
  });

  return JSON.parse(response.text || "[]");
};

export const analyzeWordInContext = async (word: string, fullSentence: string): Promise<WordAnalysis> => {
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: `Analyze the word "${word}" in the context of this sentence: "${fullSentence}".
    Provide a precise meaning for this specific context, a brief explanation, phonetics, and an image prompt.`,
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          word: { type: Type.STRING },
          meaning: { type: Type.STRING },
          context_explanation: { type: Type.STRING },
          phonetic_us: { type: Type.STRING },
          phonetic_uk: { type: Type.STRING },
          image_prompt: { type: Type.STRING },
        },
        required: ["word", "meaning", "context_explanation", "phonetic_us", "phonetic_uk", "image_prompt"],
      },
    },
  });

  return JSON.parse(response.text || "{}");
};
