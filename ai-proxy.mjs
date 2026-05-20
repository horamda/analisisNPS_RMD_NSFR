import { readFileSync } from "node:fs";
import https from "node:https";
import { resolve } from "node:path";

export const aiHeaders = {
  "Content-Type": "application/json",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const VALID_PROVIDERS = new Set(["gemini", "groq"]);

export function loadLocalEnv() {
  try {
    const lines = readFileSync(resolve(process.cwd(), ".env"), "utf8").split("\n");
    for (const line of lines) {
      const match = line.match(/^\s*([^#=\s]+)\s*=\s*(.*)\s*$/);
      if (match) process.env[match[1]] ??= match[2].replace(/^["']|["']$/g, "");
    }
  } catch {
    // .env is optional. Hosts like Railway inject variables directly.
  }
}

export function readRequestBody(req) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolveBody(body));
    req.on("error", reject);
  });
}

export function getProviderOrder() {
  const primary = (process.env.AI_PROVIDER || "gemini").toLowerCase();
  const fallback = (process.env.AI_FALLBACK_PROVIDER || "groq").toLowerCase();
  return [primary, fallback]
    .filter((provider, index, list) => VALID_PROVIDERS.has(provider) && list.indexOf(provider) === index);
}

function requestJson({ hostname, path, headers = {} }, body) {
  return new Promise((resolveRequest, reject) => {
    const req = https.request({
      hostname,
      path,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
        ...headers,
      },
    }, (res) => {
      let text = "";
      res.on("data", (chunk) => { text += chunk; });
      res.on("end", () => {
        let json = null;
        try {
          json = text ? JSON.parse(text) : null;
        } catch {
          // Keep raw text for diagnostics.
        }
        resolveRequest({ statusCode: res.statusCode || 500, json, text });
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

function contentToText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === "string") return part;
      return part?.text || part?.content || "";
    }).filter(Boolean).join("\n");
  }
  if (content === null || content === undefined) return "";
  return String(content);
}

function toGeminiBody(payload) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const systemText = messages
    .filter(message => ["system", "developer"].includes(message.role))
    .map(message => contentToText(message.content))
    .filter(Boolean)
    .join("\n\n");

  const contents = messages
    .filter(message => !["system", "developer"].includes(message.role))
    .map(message => ({
      role: message.role === "assistant" ? "model" : "user",
      parts: [{ text: contentToText(message.content) }],
    }))
    .filter(message => message.parts[0].text);

  while (contents[0]?.role === "model") {
    contents.shift();
  }

  if (!contents.length && payload.prompt) {
    contents.push({ role: "user", parts: [{ text: contentToText(payload.prompt) }] });
  }

  const generationConfig = {
    temperature: payload.temperature ?? 0.2,
    maxOutputTokens: payload.max_completion_tokens || payload.max_tokens || 1000,
  };

  if (payload.response_format?.type?.includes("json")) {
    generationConfig.responseMimeType = "application/json";
  }

  return JSON.stringify({
    ...(systemText ? { systemInstruction: { parts: [{ text: systemText }] } } : {}),
    contents,
    generationConfig,
  });
}

function toOpenAiShapeFromGemini(json, model) {
  const content = (json?.candidates?.[0]?.content?.parts || [])
    .map(part => part.text || "")
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!content) {
    throw new Error(json?.error?.message || "Gemini no devolvio contenido.");
  }

  return {
    provider: "gemini",
    model,
    choices: [{
      index: 0,
      message: { role: "assistant", content },
      finish_reason: json?.candidates?.[0]?.finishReason || "stop",
    }],
    usage: json?.usageMetadata || null,
  };
}

async function callGemini(payload) {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY no configurada");

  const model = (process.env.GEMINI_MODEL || "gemini-2.5-flash").replace(/^models\//, "");
  const body = toGeminiBody(payload);
  const response = await requestJson({
    hostname: "generativelanguage.googleapis.com",
    path: `/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
  }, body);

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.json?.error?.message || `Gemini respondio HTTP ${response.statusCode}`);
  }

  return toOpenAiShapeFromGemini(response.json, model);
}

function toGroqBody(payload) {
  const body = { ...payload };
  // GROQ_MODEL env var always wins; fall back to payload model, then hardcoded default
  body.model = process.env.GROQ_MODEL || body.model || "openai/gpt-oss-20b";
  if (/gpt-oss/i.test(body.model)) {
    delete body.response_format;
    body.reasoning_effort ??= "low";
  }
  if (body.max_tokens && !body.max_completion_tokens) {
    body.max_completion_tokens = body.max_tokens;
    delete body.max_tokens;
  }
  return JSON.stringify(body);
}

async function callGroq(payload) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("GROQ_API_KEY no configurada");

  const response = await requestJson({
    hostname: "api.groq.com",
    path: "/openai/v1/chat/completions",
    headers: { Authorization: `Bearer ${apiKey}` },
  }, toGroqBody(payload));

  if (response.statusCode < 200 || response.statusCode >= 300) {
    throw new Error(response.json?.error?.message || `Groq respondio HTTP ${response.statusCode}`);
  }

  return { provider: "groq", ...response.json };
}

export async function callAi(payload) {
  const failures = [];
  for (const provider of getProviderOrder()) {
    try {
      if (provider === "gemini") return await callGemini(payload);
      if (provider === "groq") return await callGroq(payload);
    } catch (error) {
      failures.push(`${provider}: ${error.message}`);
    }
  }

  throw new Error(`IA no disponible. ${failures.join(" | ")}`);
}
