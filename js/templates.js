/**
 * Webizer Psychological Outreach Templates
 * Website: https://webizer.vercel.app/
 * Targeted for high-converting cold WhatsApp & SMS client acquisition in India.
 */

const WEBIZER_TEMPLATES = [
  {
    id: "loss_aversion",
    name: "1. The Lost Google Customers (High Response Rate)",
    tag: "Loss Aversion",
    description: "Highlights the direct sales lost to local competitors on Google.",
    message: 
`Hi {name}, I noticed your business listed on Justdial in {area}. 

I tried searching for your official website to see your services, but couldn't find one active. Right now, when customers in {area} search on Google, they end up booking with competitors who have an official website.

At Webizer (https://webizer.vercel.app/), we build modern, fast websites for businesses in {area} in under 48 hours. 

Can I share a quick 1-minute design preview we made for {name}? No pressure at all.`
  },
  {
    id: "reputation_ego",
    name: "2. The 5-Star Reputation Gap (Social Proof)",
    tag: "Social Proof & Ego",
    description: "Praises their rating, then reveals the missing trust factor (website).",
    message: 
`Namaste {name} team! Impressive work maintaining a {rating}★ rating ({reviews} reviews) on Justdial. 

Today, 84% of high-paying customers in {area} look for an official brand website before visiting or calling to confirm credibility. Without a website, you lose that immediate trust.

We specialize in turning local reputations into modern brand websites at Webizer (https://webizer.vercel.app/). 

Would you be open to seeing a free mockup tailored for {name}?`
  },
  {
    id: "direct_leads",
    name: "3. Stop Sharing Leads with Competitors (Cost Savings)",
    tag: "Direct Inquiries",
    description: "Solves the pain of Justdial selling the same lead to 5 competitors.",
    message: 
`Hello {name}, quick observation: 

When customers find you on Justdial, Justdial often distributes your enquiry to 4-5 other competitors. Having your own direct website means 100% exclusive direct WhatsApp inquiries and zero middleman fees.

At Webizer (https://webizer.vercel.app/), we create sleek, high-converting websites that rank on Google so clients call YOU directly.

Are you available for a 2-minute chat this week on how this can grow {name}?`
  },
  {
    id: "free_concept",
    name: "4. The Free Design Concept (Reciprocity Trigger)",
    tag: "Free Value",
    description: "Offers a pre-built custom concept link, making it almost impossible to decline.",
    message: 
`Hi {name}! My team at Webizer (https://webizer.vercel.app/) was researching top {category} businesses in {area}.

We saw your Justdial listing doesn't have an official website yet, so our design team actually drafted a complimentary website concept for {name} with online appointment & direct WhatsApp buttons.

Should I send you the preview link here on WhatsApp? Takes 30 seconds to view.`
  },
  {
    id: "quick_hook",
    name: "5. The Casual Client Hook (Low Friction)",
    tag: "Curiosity & Urgency",
    description: "Short, low-pressure question that feels personal and gets opened immediately.",
    message: 
`Hi {name}, are you currently taking new clients/orders in {area}? 

Wanted to review your full service catalogue, but saw only a Justdial listing and no official website. We help top local businesses launch clean, mobile-first websites in 48 hours at Webizer (https://webizer.vercel.app/). 

Can I send over 2 sample sites we recently built for businesses in your field?`
  }
];

// Helper to format WhatsApp URL
function generateWhatsAppUrl(phone, templateId, leadData) {
  if (!phone) return "";
  let cleanPhone = String(phone).replace(/\D/g, "");
  if (cleanPhone.length === 10) cleanPhone = "91" + cleanPhone;
  if (!cleanPhone.startsWith("91") && cleanPhone.length > 10) cleanPhone = "91" + cleanPhone.slice(-10);

  const tpl = WEBIZER_TEMPLATES.find(t => t.id === templateId) || WEBIZER_TEMPLATES[0];
  let text = tpl.message;

  text = text.replace(/{name}/g, leadData.name || "Business Owner");
  text = text.replace(/{area}/g, leadData.area || leadData.city || "your area");
  text = text.replace(/{city}/g, leadData.city || "your city");
  text = text.replace(/{category}/g, leadData.category || leadData.product || "service");
  text = text.replace(/{rating}/g, leadData.rating || "top");
  text = text.replace(/{reviews}/g, leadData.reviews || "several");

  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(text)}`;
}

// Export for extension modules or window
if (typeof module !== "undefined" && module.exports) {
  module.exports = { WEBIZER_TEMPLATES, generateWhatsAppUrl };
}

