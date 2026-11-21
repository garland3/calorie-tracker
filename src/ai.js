// AI calorie estimates from a photo or a text description, using Claude.
//
// There's no server: the browser calls the Anthropic API directly with the user's own API key,
// stored only in this device's localStorage (it is never synced or committed). The SDK is loaded
// on first use so it doesn't slow down app start.
import { readJSON, writeJSON } from './data.js';

const KEY_KEY = 'cal.anthropic.key';
const MODEL_KEY = 'cal.anthropic.model';

// Cheapest first. Haiku is plenty for food estimates; bigger models may judge portions a bit better.
export const MODELS = [
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5: fastest, cheapest (~$0.001 per estimate)' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5: more careful (~$0.01)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5: most capable (~$0.02)' },
];
export const DEFAULT_MODEL = MODELS[0].id;
export const getModel = () => {
  const m = readJSON(MODEL_KEY, '');
  return MODELS.some(x => x.id === m) ? m : DEFAULT_MODEL;
};
export const setModel = id => writeJSON(MODEL_KEY, id);

export const getApiKey = () => readJSON(KEY_KEY, '') || '';
export const setApiKey = key => (key ? writeJSON(KEY_KEY, key) : localStorage.removeItem(KEY_KEY));
export const hasApiKey = () => !!getApiKey();

const SYSTEM = `You estimate nutrition for a personal calorie-tracking app.
Identify each distinct food or drink in the user's photo or description and estimate the portion
actually shown or described. Use visual cues (plate size, utensils, hands, packaging) for photos.
When a portion is unclear, assume a typical single serving and say so in the notes.
Give calories (kcal) and protein in grams for that portion as eaten, including cooking oil, butter,
sauces and dressings you can see or that are mentioned.
Name each item in 2-5 words including the portion, e.g. "Scrambled eggs (2)" or "Latte, 16 oz".
Split a meal into its main components rather than one combined item, but don't list garnishes.
If there is no food or drink, return no items and explain briefly in the notes.
Keep the notes to one short sentence about the main assumption.`;

let schemaPromise = null;
function schema() {
  schemaPromise ??= import('zod').then(({ z }) =>
    z.object({
      items: z.array(z.object({
        name: z.string(),
        kcal: z.number(),
        protein_g: z.number(),
      })),
      notes: z.string(),
    }),
  );
  return schemaPromise;
}

/** Clean up the model's items into what the app stores: rounded, non-negative, non-empty names. */
export function toEntries(items) {
  return (items || [])
    .map(i => ({
      name: String(i.name || '').trim().slice(0, 80),
      kcal: Math.max(0, Math.round(Number(i.kcal) || 0)),
      protein: Math.max(0, Math.round((Number(i.protein_g) || 0) * 10) / 10),
    }))
    .filter(i => i.name);
}

export class AiError extends Error {}

/**
 * Estimate from a description and/or a photo.
 * @param {{ text?: string, image?: { data: string, mediaType: string } }} input
 * @returns {Promise<{ items: {name, kcal, protein}[], notes: string }>}
 */
export async function estimate({ text = '', image = null }) {
  const apiKey = getApiKey();
  if (!apiKey) throw new AiError('Add your Anthropic API key in Settings first.');

  const [{ default: Anthropic }, { betaZodOutputFormat }, Schema] = await Promise.all([
    import('@anthropic-ai/sdk'),
    import('@anthropic-ai/sdk/helpers/beta/zod'),
    schema(),
  ]);
  // Browser use is deliberate: it's the user's own key, on their own device, sent only to Anthropic.
  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });

  const content = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.data } });
  content.push({
    type: 'text',
    text: text.trim()
      ? (image ? `Extra details from me: ${text.trim()}` : `What I ate: ${text.trim()}`)
      : 'Estimate what is in this photo.',
  });

  const model = getModel();
  const params = {
    model,
    max_tokens: 16000,
    // Low effort: this is a quick estimate and speed matters more than deliberation.
    output_config: { effort: 'low', format: betaZodOutputFormat(Schema) },
    system: SYSTEM,
    messages: [{ role: 'user', content }],
  };
  // Sonnet/Opus: if a safety classifier declines the request, retry on a fallback model automatically.
  // (Haiku has no server-side fallback; a refusal there is reported to the user.)
  if (model !== 'claude-haiku-5-5') Object.assign(params, { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });

  let response;
  try {
    response = await client.beta.messages.parse(params);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) throw new AiError('Your Anthropic API key was rejected. Check it in Settings.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new AiError("This API key isn't allowed to use that model.");
    if (e instanceof Anthropic.RateLimitError) throw new AiError('Rate limited by Anthropic. Try again in a moment.');
    if (e instanceof Anthropic.BadRequestError) throw new AiError('Request rejected: ' + e.message);
    if (e instanceof Anthropic.APIConnectionError) throw new AiError("Couldn't reach Anthropic. Are you online?");
    if (e instanceof Anthropic.APIError) throw new AiError(`Anthropic error ${e.status ?? ''}: ${e.message}`);
    throw e;
  }

  if (response.stop_reason === 'refusal') throw new AiError("Claude couldn't estimate this one.");
  const out = response.parsed_output;
  if (!out) throw new AiError("Couldn't read the estimate. Try again.");
  return { items: toEntries(out.items), notes: out.notes || '' };
}

/** Shrink a camera photo to at most `max` px on the long side as JPEG: faster upload, fewer tokens. */
export async function photoToJpeg(file, max = 1280, quality = 0.8) {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', quality));
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { data: btoa(bin), mediaType: 'image/jpeg', url: URL.createObjectURL(blob) };
}
