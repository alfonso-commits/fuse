export interface ChannelResult {
  channel: string;
  type: "paid" | "organic" | "outbound";
}

export function resolveChannel(
  utmSource?: string | null,
  utmMedium?: string | null,
  referrer?: string | null
): ChannelResult {
  const src = (utmSource || "").toLowerCase();
  const med = (utmMedium || "").toLowerCase();
  const ref = (referrer || "").toLowerCase();

  // Paid channels
  if (src === "google" && ["cpc", "paid"].includes(med))
    return { channel: "Google Ads", type: "paid" };
  if (src === "linkedin" && ["cpc", "paid"].includes(med))
    return { channel: "LinkedIn Ads", type: "paid" };
  if (["facebook", "meta"].includes(src) && ["cpc", "paid"].includes(med))
    return { channel: "Meta Ads", type: "paid" };

  // Organic social
  if (src === "linkedin" && ["social", "organic"].includes(med))
    return { channel: "LinkedIn Posts", type: "organic" };
  if (["twitter", "x"].includes(src) && ["social", "organic"].includes(med))
    return { channel: "X Posts", type: "organic" };

  // Outbound
  if (src === "sdr")
    return { channel: "Cold Outreach (SDR)", type: "outbound" };
  if (src === "email")
    return { channel: "Email Outreach", type: "outbound" };

  // Referrer-based fallback
  if (ref.includes("google."))
    return { channel: "Organic Search", type: "organic" };
  if (ref.includes("bing."))
    return { channel: "Organic Search", type: "organic" };
  if (ref.includes("linkedin."))
    return { channel: "LinkedIn (Organic)", type: "organic" };
  if (ref.includes("twitter.") || ref.includes("x.com"))
    return { channel: "X (Organic)", type: "organic" };

  // No signal
  if (!ref && !src) return { channel: "Direct", type: "organic" };

  // Has referrer but no match
  return { channel: "Referral", type: "organic" };
}
