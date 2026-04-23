import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import { fileURLToPath } from "url";
import { dirname } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const app = express();
app.use(express.json());

app.use((_req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  next();
});
app.options("*", (_req, res) => res.sendStatus(204));

app.use(express.static(__dirname));

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DISCORD_WEBHOOK =
  "https://discord.com/api/webhooks/1497004514434089072/M1YWPKgPqOS4SC_cV3xUpAta4jDrYbnzDR5zxBZ0ewtgpjxW6K_C2tqXG7uL-vfnXMVC";

async function sendLeadToDiscord(lead) {
  try {
    await fetch(DISCORD_WEBHOOK, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content:
          `🎯 **ליד חדש התקבל!**\n` +
          `👤 **שם:** ${lead.name}\n` +
          `📞 **טלפון:** ${lead.phone}\n` +
          `📝 **תיאור:** ${lead.description}`,
      }),
    });
    console.log("Lead sent to Discord:", lead);
  } catch (err) {
    console.log("Failed to send lead to Discord:", err.message);
  }
}

const TOOLS = [
  {
    name: "save_lead",
    description:
      "שמור פרטי לקוח פוטנציאלי שנאספו במהלך השיחה. קרא לפונקציה הזו רק כשיש לך את שלושת הפרטים: שם, טלפון ותיאור.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "שם מלא של הלקוח" },
        phone: { type: "string", description: "מספר טלפון ליצירת קשר" },
        description: { type: "string", description: "תיאור קצר של הצורך / השירות המבוקש" },
      },
      required: ["name", "phone", "description"],
    },
  },
];

const DEFAULT_SYSTEM = `אתה נציג שירות ומכירות של חברת Prime South – חברה מובילה לפתרונות קריאייטיב ודיגיטל.

שירותי החברה:
- דפי נחיתה מעוצבים ואפקטיביים
- פלאיירים ועיצוב גרפי שיווקי
- בניית אבות-טיפוס (Prototypes) לאפליקציות ומוצרים דיגיטליים
- פיתוח סוכני AI מותאמים אישית לעסקים

הנחיות לשיחה:
1. ענה תמיד בעברית רהוטה, מקצועית ואדיבה.
2. מטרתך: לתת מענה ראשוני איכותי ולסגור ליד – לאסוף פרטי יצירת קשר ולהעביר אותם לצוות.
3. **איסוף פרטי ליד:** במהלך השיחה, אסוף בצורה טבעית, חמה ושירותית את הפרטים הבאים:
   - שם מלא של הלקוח
   - מספר טלפון ליצירת קשר
   - תיאור קצר של הצורך או השירות המבוקש
   ברגע שיש לך את שלושת הפרטים הללו, קרא לכלי save_lead כדי לשמור אותם.
   לאחר שמירת הליד, הודע ללקוח בחום שפרטיו התקבלו ושנציג יחזור אליו בהקדם.
4. הדגש שהעבודות ברמה הגבוהה ביותר בשוק, ושהמחירים הם ללא ספק האטרקטיביים ביותר – אך אל תנקוב בסכומים ספציפיים.
5. אם הלקוח מבקש לדבר עם נציג אנושי, הפנה אותו לאחד משני האנשים הבאים:
   - נתנאל: 052-8325875
   - יוסף: 054-4879735
6. שמור על שיחה חמה וזורמת – אל תהיה רובוטי.
7. אם הלקוח שואל על שירות שלא ברשימה, אמור שתבדוק ותחזור אליו, ובקש פרטי קשר.`;

const MODEL = "claude-opus-4-7";
const TIMEOUT_MS = 30000;

app.post("/chat", async (req, res) => {
  console.log("--- New Request Received ---");

  const { messages, system, stream = false } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages must be a non-empty array" });
  }

  const systemPrompt = system || DEFAULT_SYSTEM;

  const controller = new AbortController();
  const timer = setTimeout(() => {
    console.log("!!! TIMEOUT: Aborting Anthropic request after 30s");
    controller.abort();
  }, TIMEOUT_MS);

  if (stream) {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");

    try {
      const conversationMessages = [...messages];

      // Loop to handle tool-use turns
      while (true) {
        console.log("Sending to Anthropic...");

        let textBuffer = "";
        let toolUses = [];
        let currentToolUse = null;
        let stopReason = null;

        const apiStream = client.messages.stream(
          {
            model: MODEL,
            max_tokens: 1024,
            system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
            messages: conversationMessages,
            tools: TOOLS,
          },
          { signal: controller.signal }
        );

        console.log("Response received from Anthropic!");

        for await (const event of apiStream) {
          if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
            currentToolUse = {
              id: event.content_block.id,
              name: event.content_block.name,
              inputJson: "",
            };
          } else if (event.type === "content_block_delta") {
            if (event.delta.type === "text_delta") {
              textBuffer += event.delta.text;
              res.write(`data: ${JSON.stringify({ type: "delta", text: event.delta.text })}\n\n`);
            } else if (event.delta.type === "input_json_delta" && currentToolUse) {
              currentToolUse.inputJson += event.delta.partial_json;
            }
          } else if (event.type === "content_block_stop" && currentToolUse) {
            try { currentToolUse.input = JSON.parse(currentToolUse.inputJson); } catch { currentToolUse.input = {}; }
            toolUses.push(currentToolUse);
            currentToolUse = null;
          } else if (event.type === "message_delta") {
            stopReason = event.delta.stop_reason;
          }
        }

        if (stopReason === "tool_use" && toolUses.length > 0) {
          // Build assistant message with text + tool_use blocks
          const assistantContent = [];
          if (textBuffer) assistantContent.push({ type: "text", text: textBuffer });
          for (const tu of toolUses) {
            assistantContent.push({ type: "tool_use", id: tu.id, name: tu.name, input: tu.input });
          }
          conversationMessages.push({ role: "assistant", content: assistantContent });

          // Execute tools and build tool_result messages
          const toolResults = [];
          for (const tu of toolUses) {
            if (tu.name === "save_lead") {
              await sendLeadToDiscord(tu.input);
              toolResults.push({ type: "tool_result", tool_use_id: tu.id, content: "הליד נשמר בהצלחה!" });
            }
          }
          conversationMessages.push({ role: "user", content: toolResults });

          // Reset buffers and continue to get the follow-up response
          textBuffer = "";
          toolUses = [];
          continue;
        }

        // stop_reason is "end_turn" — done
        break;
      }

      clearTimeout(timer);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    } catch (error) {
      clearTimeout(timer);
      console.log("!!! ERROR DETECTED:", JSON.stringify(error, null, 2));
      res.write(`data: ${JSON.stringify({ type: "error", error: error.message })}\n\n`);
      res.end();
    }
  } else {
    try {
      console.log("Sending to Anthropic...");
      const response = await client.messages.create(
        {
          model: MODEL,
          max_tokens: 1024,
          system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
          messages,
          tools: TOOLS,
        },
        { signal: controller.signal }
      );

      console.log("Response received from Anthropic!");
      clearTimeout(timer);

      const text = response.content
        .filter((b) => b.type === "text")
        .map((b) => b.text)
        .join("");

      res.json({ role: "assistant", content: text, usage: response.usage });
    } catch (error) {
      clearTimeout(timer);
      console.log("!!! ERROR DETECTED:", JSON.stringify(error, null, 2));
      const status = error.status ?? 500;
      res.status(status).json({ error: error.message });
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
