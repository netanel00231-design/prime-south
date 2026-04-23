import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

// Allow cross-origin requests (needed when embedding in an external landing page)
app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

// Serve index.html at the root
app.use(express.static(__dirname));

const client = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const DEFAULT_SYSTEM = `אתה נציג שירות ומכירות של חברת Prime South – חברה מובילה לפתרונות קריאייטיב ודיגיטל.

שירותי החברה:
- דפי נחיתה מעוצבים ואפקטיביים
- פלאיירים ועיצוב גרפי שיווקי
- בניית אבות-טיפוס (Prototypes) לאפליקציות ומוצרים דיגיטליים
- פיתוח סוכני AI מותאמים אישית לעסקים

הנחיות לשיחה:
1. ענה תמיד בעברית רהוטה, מקצועית ואדיבה.
2. מטרתך: לתת מענה ראשוני איכותי ולסגור ליד – לגרום ללקוח להשאיר פרטים או לדרוש הצעת מחיר.
3. הדגש שהעבודות ברמה הגבוהה ביותר בשוק, ושהמחירים הם ללא ספק האטרקטיביים ביותר – אך אל תנקוב בסכומים ספציפיים.
4. אם הלקוח מבקש לדבר עם נציג אנושי, הפנה אותו לאחד משני האנשים הבאים:
   - נתנאל: 052-8325875
   - יוסף: 054-4879735
5. שמור על שיחה חמה וזורמת – אל תהיה רובוטי.
6. אם הלקוח שואל על שירות שלא ברשימה, אמור שתבדוק ותחזור אליו, ובקש פרטי קשר.`;
const MODEL = "claude-opus-4-7";

/**
 * POST /chat
 *
 * Body:
 *   messages  - array of { role: "user" | "assistant", content: string }
 *   system    - optional system prompt (defaults to DEFAULT_SYSTEM)
 *   stream    - optional boolean, defaults to false
 *
 * Non-streaming response:
 *   { role: "assistant", content: string, usage: { input_tokens, output_tokens, ... } }
 *
 * Streaming response (stream: true):
 *   Content-Type: text/event-stream
 *   data: { type: "delta", text: "..." }
 *   data: { type: "done", usage: {...} }
 */
app.post("/chat", async (req, res) => {
  const { messages, system, stream = false } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }

  const systemPrompt = system || DEFAULT_SYSTEM;

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const apiStream = client.messages.stream({
        model: MODEL,
        max_tokens: 64000,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages,
      });

      for await (const event of apiStream) {
        if (
          event.type === "content_block_delta" &&
          event.delta.type === "text_delta"
        ) {
          res.write(`data: ${JSON.stringify({ type: "delta", text: event.delta.text })}\n\n`);
        }
      }

      const final = await apiStream.finalMessage();
      res.write(`data: ${JSON.stringify({ type: "done", usage: final.usage })}\n\n`);
      res.end();
    } catch (err) {
      res.write(`data: ${JSON.stringify({ type: "error", error: err.message })}\n\n`);
      res.end();
    }
  } else {
    try {
      const response = await client.messages.create({
        model: MODEL,
        max_tokens: 16000,
        system: [
          {
            type: "text",
            text: systemPrompt,
            cache_control: { type: "ephemeral" },
          },
        ],
        messages,
      });

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      res.json({
        role: "assistant",
        content: text,
        usage: response.usage,
      });
    } catch (err) {
      const status = err.status ?? 500;
      res.status(status).json({ error: err.message });
    }
  }
});

// Health check
app.get("/health", (_req, res) => res.json({ ok: true }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`POST /chat  – send chat messages`);
  console.log(`GET  /health – health check`);
});
