export const OPENROUTER_CHAT_PARAMS = {
  temperature: 0.65,
  top_p: 0.9,
  max_tokens: 240,
  presence_penalty: 0.25,
  frequency_penalty: 0.15
};

export const ELEVENLABS_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.8,
  style: 0.25,
  use_speaker_boost: true
  // Speed is omitted to avoid breaking if unsupported; add here if the API supports it.
};
