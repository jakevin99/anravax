/**
 * SMS provider abstraction.
 *
 * Two implementations:
 *  - "stub" (default in dev): logs the message to stdout and returns success.
 *  - "semaphore": calls Semaphore.co.ph, the most common SMS gateway in PH.
 *
 * Pick one with `SMS_PROVIDER=stub|semaphore` in `.env`.
 *
 * The OTP routes never look at the actual SMS body so we always return
 * `{ ok: true }` even on stub — production will report the real error.
 */

const SEMAPHORE_URL = "https://api.semaphore.co.ph/api/v4/messages";

export function getSmsProvider() {
  return (process.env.SMS_PROVIDER ?? "stub").trim().toLowerCase();
}

export async function sendSms({ to, message }) {
  const provider = getSmsProvider();
  if (provider === "semaphore") {
    return sendViaSemaphore({ to, message });
  }
  return sendViaStub({ to, message });
}

async function sendViaStub({ to, message }) {
  // eslint-disable-next-line no-console
  console.log(`[sms:stub] to=${to} message=${message}`);
  return { ok: true, provider: "stub" };
}

async function sendViaSemaphore({ to, message }) {
  const apiKey = (process.env.SEMAPHORE_API_KEY ?? "").trim();
  const sender = (process.env.SEMAPHORE_SENDER_NAME ?? "ANIVAX").trim();
  if (!apiKey) {
    throw Object.assign(new Error("SEMAPHORE_API_KEY is not set."), {
      code: "SMS_CONFIG_MISSING",
    });
  }
  const form = new URLSearchParams();
  form.set("apikey", apiKey);
  form.set("number", String(to));
  form.set("message", String(message));
  form.set("sendername", sender);
  const res = await fetch(SEMAPHORE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw Object.assign(
      new Error(`Semaphore HTTP ${res.status}: ${text.slice(0, 200)}`),
      { code: "SMS_PROVIDER_ERROR" },
    );
  }
  return { ok: true, provider: "semaphore" };
}
