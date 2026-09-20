/**
 * Sylvy's turn endpoint.
 *
 * Streams plain text deltas rather than JSON so the panel can render as the
 * answer arrives. With no NVIDIA_API_KEY set the route falls back to a
 * deterministic responder built from the same briefing, which keeps the demo
 * honest offline instead of showing an error where the analyst should be.
 */

import {
  SYLVY_SYSTEM,
  type SylvyContext,
  type SylvyTurn,
  renderBrief,
} from "@/lib/sylvy/context";
import { offlineAnswer } from "@/lib/sylvy/offline";

export const runtime = "nodejs";
export const maxDuration = 60;

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
// kimi-k3's hosted endpoint on NVIDIA currently hangs indefinitely (verified:
// zero bytes back after 40s, streaming or not, reasoning_effort or not, on
// two separate networks). gpt-oss-20b is a live, fast, reasoning-capable
// model on the same account/key — swap back once kimi-k3 recovers.
const MODEL = "openai/gpt-oss-20b";
// Hard ceiling on waiting for the model to say anything at all. NVIDIA's
// hosted endpoints occasionally hang with zero bytes back rather than
// erroring, which used to mean Sylvy sat "thinking" forever with no signal.
const UPSTREAM_TIMEOUT_MS = 20_000;
// Shown to the user on any real failure (timeout, upstream error, crashed
// stream). The actual cause always goes to console.error above this — this
// string is deliberately uninformative so Sylvy never reads as broken UI.
const GENERIC_ERROR = "Sorry, an error occurred.";

interface Body {
  messages: SylvyTurn[];
  context: SylvyContext;
}

export async function POST(request: Request) {
  console.log("[Sylvy] POST request received");
  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch (e) {
    console.error("[Sylvy] Malformed JSON:", e);
    return new Response("Malformed request.", { status: 400 });
  }

  const { messages, context } = body;
  console.log(`[Sylvy] ${messages?.length ?? 0} messages, context:`, {
    city: context?.city,
    livability: context?.livability,
    briefSize: context ? renderBrief(context).length : 0,
  });

  if (!messages?.length || !context) {
    console.warn("[Sylvy] Missing messages or context");
    return new Response("A question and a city briefing are both required.", {
      status: 400,
    });
  }

  const brief = renderBrief(context);
  const key = process.env.NVIDIA_API_KEY;
  console.log("[Sylvy] API key present?", !!key, key?.slice(0, 20) + "...");

  if (!key) {
    console.log("[Sylvy] No API key, using offline responder");
    return textStream(offlineAnswer(messages[messages.length - 1].content, context));
  }

  try {
    const payload = {
      model: MODEL,
      stream: true,
      max_tokens: 1200,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: `${SYLVY_SYSTEM}\n\nCurrent briefing:\n\n${brief}` },
        ...messages.slice(-12).map((m) => ({ role: m.role, content: m.content })),
      ],
    };
    console.log("[Sylvy] Sending to", MODEL, {
      msgCount: payload.messages.length,
      lastUserMsg: messages[messages.length - 1]?.content?.slice(0, 100),
    });

    const t0 = Date.now();
    const abort = new AbortController();
    const giveUp = setTimeout(() => {
      console.warn(`[Sylvy] No response from ${MODEL} within ${UPSTREAM_TIMEOUT_MS}ms — aborting`);
      abort.abort();
    }, UPSTREAM_TIMEOUT_MS);

    let upstream: Response;
    try {
      upstream = await fetch(NVIDIA_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify(payload),
        signal: abort.signal,
      });
    } finally {
      clearTimeout(giveUp);
    }

    console.log(`[Sylvy] Connected to ${MODEL} in ${Date.now() - t0}ms —`, {
      status: upstream.status,
      ok: upstream.ok,
      hasBody: !!upstream.body,
    });

    if (!upstream.ok || !upstream.body) {
      const text = await upstream.text();
      console.error("[Sylvy] Upstream rejected the request:", upstream.status, text);
      throw new Error(`${MODEL} returned ${upstream.status}: ${text.slice(0, 200)}`);
    }

    const reader = upstream.body.getReader();

    return new Response(new ReadableStream<Uint8Array>({
      async start(controller) {
        const encoder = new TextEncoder();
        const decoder = new TextDecoder();
        let buffer = "";
        let chunkCount = 0;
        let contentChars = 0;
        let reasoningChars = 0;
        // Phase tracking purely for the console: Kimi/gpt-oss both "think"
        // (reasoning_content) before they "write" (content), and a run that
        // stalls mid-thought looks identical to a hang without this.
        let phase: "waiting" | "thinking" | "writing" = "waiting";
        let firstByteAt: number | null = null;

        const setPhase = (next: typeof phase) => {
          if (phase === next) return;
          const elapsed = Date.now() - t0;
          console.log(`[Sylvy] ${phase} -> ${next} at +${elapsed}ms`);
          phase = next;
        };

        try {
          for (;;) {
            const { done, value } = await reader.read();
            if (done) {
              console.log("[Sylvy] Stream done.", {
                totalMs: Date.now() - t0,
                chunks: chunkCount,
                reasoningChars,
                contentChars,
              });
              break;
            }
            if (firstByteAt === null) {
              firstByteAt = Date.now();
              console.log(`[Sylvy] First byte from ${MODEL} at +${firstByteAt - t0}ms`);
            }
            buffer += decoder.decode(value, { stream: true });

            const lines = buffer.split("\n");
            buffer = lines.pop() ?? "";

            for (const line of lines) {
              if (!line.startsWith("data: ")) continue;
              const payload = line.slice(6).trim();
              if (payload === "[DONE]") {
                console.log(`[Sylvy] Received [DONE] at +${Date.now() - t0}ms`);
                continue;
              }

              try {
                chunkCount++;
                const chunk = JSON.parse(payload);
                const delta = chunk.choices?.[0]?.delta ?? {};
                // Different providers spell the thinking trace differently.
                const reasoning: string | undefined = delta.reasoning_content ?? delta.reasoning;
                const content: string | undefined = delta.content;

                if (reasoning) {
                  setPhase("thinking");
                  reasoningChars += reasoning.length;
                } else if (content) {
                  setPhase("writing");
                  contentChars += content.length;
                  controller.enqueue(encoder.encode(content));
                }

                const finishReason = chunk.choices?.[0]?.finish_reason;
                if (finishReason) {
                  console.log(`[Sylvy] finish_reason: ${finishReason} at +${Date.now() - t0}ms`);
                  if (finishReason === "length" && contentChars === 0) {
                    console.warn(
                      "[Sylvy] Hit max_tokens while still thinking — no answer text was ever produced. Raise max_tokens or lower reasoning_effort.",
                    );
                  }
                }
              } catch (parseErr) {
                console.log("[Sylvy] Chunk parse skip:", line.slice(0, 80), "error:", parseErr);
              }
            }
          }
        } catch (err) {
          const timedOut = abort.signal.aborted;
          console.error("[Sylvy] Stream error:", { timedOut, err });
          // User-facing text stays generic; the real reason is in the log above.
          controller.enqueue(encoder.encode(GENERIC_ERROR));
        } finally {
          console.log("[Sylvy] Stream closed");
          controller.close();
        }
      },
      cancel() {
        console.log("[Sylvy] Stream cancelled by client");
        reader.cancel();
      },
    }), {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err) {
    console.error("[Sylvy] Caught error:", err);
    return textStream(GENERIC_ERROR);
  }
}

/** Serves a fixed string through the same streaming contract as the model. */
function textStream(text: string): Response {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(text));
        controller.close();
      },
    }),
    {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      },
    },
  );
}
