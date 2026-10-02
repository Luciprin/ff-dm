import { getStore } from '@netlify/blobs';
import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

const store = getStore({ name: 'ff-dm-data', consistency: 'strong' });
const COOKIE = 'ffdm_admin';
const MAX_MESSAGE = 2000;
const DEFAULT_CONFIG = {
  welcome: 'Bienvenue. Prends ton temps, je suis là pour discuter avec toi.',
  steps: [{ prompt: 'Qu’aimerais-tu savoir ou partager aujourd’hui ?', response: 'Merci pour ton message. Je t’écoute, continue.' }]
};
const ADMIN_PASSWORD_HASH = '9441957831839c837b450573fd9a97c2f5e39ced2ff36bb778d827f6e4a970ec';

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extraHeaders } });
}
function passwordHash(value) { return createHmac('sha256', 'ffdm-admin').update(value).digest('hex'); }
function sign(value) { return createHmac('sha256', ADMIN_PASSWORD_HASH).update(value).digest('base64url'); }
function makeSession() {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  const body = `${exp}.${randomBytes(18).toString('base64url')}`;
  return `${body}.${sign(body)}`;
}
function validSession(request) {
  const raw = request.headers.get('cookie') || '';
  const match = raw.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  if (!match) return false;
  let token;
  try { token = decodeURIComponent(match[1]); } catch { return false; }
  const parts = token.split('.');
  if (parts.length !== 3 || Number(parts[0]) < Date.now()) return false;
  const expected = sign(`${parts[0]}.${parts[1]}`);
  const a = Buffer.from(parts[2]); const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function sessionCookie(token) { return `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=43200`; }
function clearCookie() { return `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`; }
async function readJSON(request) { try { return await request.json(); } catch { return {}; } }
function cleanConfig(value) {
  const welcome = String(value?.welcome ?? DEFAULT_CONFIG.welcome).trim().slice(0, 2000) || DEFAULT_CONFIG.welcome;
  const rawSteps = Array.isArray(value?.steps) ? value.steps : DEFAULT_CONFIG.steps;
  const steps = rawSteps.slice(0, 30).map(step => ({
    prompt: String(step?.prompt ?? '').trim().slice(0, 2000),
    response: String(step?.response ?? '').trim().slice(0, 5000)
  })).filter(step => step.prompt && step.response);
  return { welcome, steps: steps.length ? steps : DEFAULT_CONFIG.steps };
}
async function getConfig() {
  const current = await store.get('config/scenario', { type: 'json' });
  if (current) return cleanConfig(current);
  // Keep the previous release's single-response setting when upgrading an existing site.
  const legacy = await store.get('config/current-response', { type: 'json' });
  if (legacy?.response) return { welcome: DEFAULT_CONFIG.welcome, steps: [{ prompt: DEFAULT_CONFIG.steps[0].prompt, response: String(legacy.response).slice(0, 5000) }] };
  return DEFAULT_CONFIG;
}

export default async (request) => {
  const url = new URL(request.url);
  const action = url.searchParams.get('action') || '';
  try {
    if (request.method === 'GET' && action === 'config') {
      const config = await getConfig();
      return json({ welcome: config.welcome, firstPrompt: config.steps[0].prompt });
    }

    if (request.method === 'POST' && action === 'message') {
      const body = await readJSON(request);
      const question = String(body.message || '').trim();
      const conversationId = String(body.conversationId || '').trim();
      if (!question || question.length > MAX_MESSAGE || !/^[a-zA-Z0-9_-]{8,80}$/.test(conversationId)) return json({ error: 'Message invalide.' }, 400);

      // Fetch the latest scenario at send time, not when the visitor opened the page.
      const config = await getConfig();
      const stateKey = `conversation-state/${conversationId}`;
      const state = await store.get(stateKey, { type: 'json' });
      const index = Number.isInteger(state?.nextIndex) ? ((state.nextIndex % config.steps.length) + config.steps.length) % config.steps.length : 0;
      const step = config.steps[index];
      const nextIndex = (index + 1) % config.steps.length;
      const id = `${Date.now()}-${randomBytes(6).toString('hex')}`;
      const createdAt = new Date().toISOString();
      const record = { id, conversationId, question, prompt: step.prompt, response: step.response, stepIndex: index, createdAt };
      await store.setJSON(`messages/${id}`, record);
      await store.setJSON(stateKey, { nextIndex, updatedAt: createdAt });
      const nextPrompt = config.steps[nextIndex]?.prompt || config.steps[0].prompt;
      return json({ response: step.response, nextPrompt });
    }

    if (request.method === 'POST' && action === 'admin-login') {
      const body = await readJSON(request);
      const supplied = String(body.password || '');
      if (!supplied || passwordHash(supplied) !== ADMIN_PASSWORD_HASH) return json({ error: 'Mot de passe incorrect.' }, 401);
      return json({ ok: true }, 200, { 'set-cookie': sessionCookie(makeSession()) });
    }

    if (request.method === 'POST' && action === 'admin-logout') return json({ ok: true }, 200, { 'set-cookie': clearCookie() });
    if (!validSession(request)) return json({ error: 'Accès refusé.' }, 401);

    if (request.method === 'GET' && action === 'admin-state') {
      const { blobs } = await store.list({ prefix: 'messages/' });
      const messages = [];
      for (const blob of blobs) { const item = await store.get(blob.key, { type: 'json' }); if (item) messages.push(item); }
      messages.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      return json({ config: await getConfig(), messages });
    }

    if (request.method === 'PUT' && action === 'scenario') {
      const body = await readJSON(request);
      if (!String(body.welcome || '').trim()) return json({ error: 'La phrase d’accueil est obligatoire.' }, 400);
      if (!Array.isArray(body.steps) || body.steps.length < 1 || body.steps.length > 30) return json({ error: 'Ajoute entre 1 et 30 échanges.' }, 400);
      if (body.steps.some(s => !String(s?.prompt || '').trim() || !String(s?.response || '').trim())) return json({ error: 'Chaque échange doit avoir une question et une réponse.' }, 400);
      const config = cleanConfig(body);
      await store.setJSON('config/scenario', { ...config, updatedAt: new Date().toISOString() });
      return json({ ok: true, config });
    }

    return json({ error: 'Route inconnue.' }, 404);
  } catch (error) {
    console.error(error);
    return json({ error: 'Erreur serveur. Réessaie dans un instant.' }, 500);
  }
};
