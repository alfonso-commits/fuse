import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL,
});

const channels = [
  { name: "Google Ads", slug: "google-ads", type: "paid", description: "Google Ads (Search, Display, YouTube)" },
  { name: "LinkedIn Ads", slug: "linkedin-ads", type: "paid", description: "LinkedIn sponsored content and ads" },
  { name: "Meta Ads", slug: "meta-ads", type: "paid", description: "Facebook and Instagram ads" },
  { name: "LinkedIn Posts", slug: "linkedin-posts", type: "organic", description: "Organic LinkedIn posts and articles" },
  { name: "X Posts", slug: "x-posts", type: "organic", description: "Organic posts on X (Twitter)" },
  { name: "Organic Search", slug: "organic-search", type: "organic", description: "Google, Bing, and other search engines" },
  { name: "Cold Outreach (SDR)", slug: "cold-outreach-sdr", type: "outbound", description: "Cold outreach via SDR team" },
  { name: "Email Outreach", slug: "email-outreach", type: "outbound", description: "Email marketing campaigns" },
  { name: "Direct", slug: "direct", type: "organic", description: "Direct traffic (no referrer)" },
  { name: "Referral", slug: "referral", type: "organic", description: "Referral from other websites" },
];

async function main() {
  console.log("Seeding channels...");
  for (const ch of channels) {
    await prisma.channel.upsert({
      where: { slug: ch.slug },
      update: { name: ch.name, type: ch.type, description: ch.description },
      create: ch,
    });
  }
  console.log(`Seeded ${channels.length} channels.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => {
    prisma.$disconnect();
  });
