import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import puppeteer from "puppeteer";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// ─────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────

function upgradeToFullRes(url) {
    return url.replace(/\._[A-Za-z0-9_,]+_\./g, ".");
}

function dedupe(images) {
    return [...new Set(images)];
}

function sleep(ms) {
    return new Promise((res) => setTimeout(res, ms));
}

function extractImages(html) {
    const extractedImages = [];
    const dynamicRegex = /data-a-dynamic-image=["']({[^"']+})["']/g;
    let match;
    while ((match = dynamicRegex.exec(html)) !== null) {
        try {
            const json = JSON.parse(match[1].replace(/&quot;/g, '"'));
            for (const img of Object.keys(json)) {
                extractedImages.push(upgradeToFullRes(img));
            }
        } catch (_) { }
    }

    // Fallback: also grab og:image and standard img tags via cheerio
    const $ = cheerio.load(html);
    $('meta[property="og:image"]').each((_, el) => {
        const content = $(el).attr("content");
        if (content) extractedImages.push(content);
    });
    $('img[src*="images/I/"]').each((_, el) => {
        const src = $(el).attr("src");
        if (src) extractedImages.push(upgradeToFullRes(src));
    });

    return dedupe(extractedImages).slice(0, 5);
}

function cleanHtmlToText(html) {
    return html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 15000);
}

// ─────────────────────────────────────────────
// STRATEGY 1 — Puppeteer (full JS rendering)
// ─────────────────────────────────────────────

async function fetchWithPuppeteer(url) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            protocolTimeout: 120000,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--disable-web-security",
                "--disable-features=IsolateOrigins,site-per-process",
            ],
        });

        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(60000);
        page.setDefaultTimeout(60000);

        // Mimic a real browser
        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
            "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        );
        await page.setExtraHTTPHeaders({
            "Accept-Language": "en-US,en;q=0.9",
        });

        // Block heavy resources to speed up load
        await page.setRequestInterception(true);
        page.on("request", (req) => {
            const type = req.resourceType();
            if (["font", "media", "websocket"].includes(type)) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });

        // Wait for key Amazon content selectors (fail gracefully if absent)
        await Promise.race([
            page.waitForSelector("#productTitle", { timeout: 10000 }).catch(() => { }),
            sleep(10000),
        ]);

        // Get HTML with a hard cap timeout to prevent callFunctionOn hangs
        const html = await Promise.race([
            page.content(),
            sleep(30000).then(() => { throw new Error("page.content() timed out"); }),
        ]);

        return html;
    } finally {
        if (browser) {
            await browser.close().catch(() => { });
        }
    }
}

// ─────────────────────────────────────────────
// STRATEGY 2 — Axios + Cheerio (lightweight)
// ─────────────────────────────────────────────

async function fetchWithAxios(url) {
    const response = await axios.get(url, {
        timeout: 30000,
        headers: {
            "User-Agent":
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
            Accept:
                "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Cache-Control": "no-cache",
        },
    });
    return response.data;
}

// ─────────────────────────────────────────────
// STRATEGY 3 — Axios with rotated User-Agents
// ─────────────────────────────────────────────

const USER_AGENTS = [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4.1 Safari/605.1.15",
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0",
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function randomUA() {
    return USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
}

async function fetchWithRotatedAxios(url) {
    const response = await axios.get(url, {
        timeout: 30000,
        headers: {
            "User-Agent": randomUA(),
            "Accept-Language": "en-US,en;q=0.9",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Cache-Control": "no-cache",
            Referer: "https://www.google.com/",
            DNT: "1",
        },
    });
    return response.data;
}

// ─────────────────────────────────────────────
// STRATEGY 4 — Puppeteer with stealth tweaks
// (second Puppeteer attempt with longer waits)
// ─────────────────────────────────────────────

async function fetchWithPuppeteerStealth(url) {
    let browser;
    try {
        browser = await puppeteer.launch({
            headless: "new",
            protocolTimeout: 120000,
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu",
                "--window-size=1366,768",
                "--disable-blink-features=AutomationControlled",
            ],
        });

        const page = await browser.newPage();
        page.setDefaultNavigationTimeout(90000);
        page.setDefaultTimeout(90000);

        await page.setUserAgent(randomUA());
        await page.setViewport({ width: 1366, height: 768 });
        await page.setExtraHTTPHeaders({ "Accept-Language": "en-US,en;q=0.9" });

        // Hide webdriver fingerprint
        await page.evaluateOnNewDocument(() => {
            Object.defineProperty(navigator, "webdriver", { get: () => undefined });
        });

        await page.setRequestInterception(true);
        page.on("request", (req) => {
            if (["font", "media", "websocket"].includes(req.resourceType())) {
                req.abort();
            } else {
                req.continue();
            }
        });

        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });

        // Wait longer for heavy pages
        await Promise.race([
            page.waitForSelector("#productTitle", { timeout: 15000 }).catch(() => { }),
            sleep(15000),
        ]);

        const html = await Promise.race([
            page.content(),
            sleep(45000).then(() => { throw new Error("page.content() timed out"); }),
        ]);

        return html;
    } finally {
        if (browser) await browser.close().catch(() => { });
    }
}

// ─────────────────────────────────────────────
// FETCH ORCHESTRATOR — tries each strategy
// ─────────────────────────────────────────────

async function fetchHtmlWithFallbacks(url) {
    const strategies = [
        { name: "Puppeteer", fn: () => fetchWithPuppeteer(url) },
        { name: "Axios", fn: () => fetchWithAxios(url) },
        { name: "Axios-RotatedUA", fn: () => fetchWithRotatedAxios(url) },
        { name: "Puppeteer-Stealth", fn: () => fetchWithPuppeteerStealth(url) },
    ];

    let lastError;

    for (const strategy of strategies) {
        try {
            console.log(`[Scraper] Trying strategy: ${strategy.name}`);
            const html = await strategy.fn();
            if (!html || html.length < 500) throw new Error("Response too short");
            console.log(`[Scraper] Success with: ${strategy.name}`);
            return html;
        } catch (err) {
            console.warn(`[Scraper] ${strategy.name} failed: ${err.message}`);
            lastError = err;
        }
    }

    throw new Error(`All scraping strategies failed. Last error: ${lastError?.message}`);
}

// ─────────────────────────────────────────────
// AI EXTRACTION
// ─────────────────────────────────────────────

async function extractWithAI(textContent) {
    const prompt = `
You are an expert Amazon product analyst and beauty specialist AI assistant.
 
Your job is to analyze any Amazon product URL or product content that the user 
shares and instantly provide them with complete, structured, easy-to-read product 
details — like a knowledgeable shopping assistant who knows everything about the product.

YOUR PERSONALITY
- Friendly, helpful and professional
- Speak like a knowledgeable beauty advisor
- Be concise but thorough
- Never make up information — if a detail is not available, say "Not mentioned"
- Always present information in a clean, readable format

WHEN A USER SHARES A PRODUCT URL OR CONTENT

Immediately analyse the product and respond with ALL of the following sections.
Never skip any section. If data is unavailable, write "Not mentioned".

PRODUCT OVERVIEW

 Product Name     : 
 Brand            : 
 Category         : 
 Subcategory      : 
 Generic Name     : 
 Item Form        : (Gel / Cream / Serum / Oil / Powder etc.)
 Net Quantity     : 
 Weight           : 
 Dimensions       : 
 Country of Origin: 
 Manufacturer     : 
 Packer           : 
 ASIN             : 
 Model Number     : 
 Date First Available: 
 Discontinued     :

 PRODUCT SUMMARY
Write 3 sentences (300–500 chars):
- Sentence 1: What the product is + hero ingredient
- Sentence 2: Key benefits for skin or hair
- Sentence 3: Who it is best suited for + best occasion to use

KEY INGREDIENTS
List each ingredient with a one-line explanation of what it does:
- [Ingredient 1] – [what it does for skin/hair]
- [Ingredient 2] – [what it does for skin/hair]
(list all available)
 
 Hero Ingredient : [single most important ingredient and why]

KEY BENEFITS
List 5–8 specific benefits this product delivers:
✅ 
✅ 
 WHO IS THIS FOR?
Target Audience  : 
Skin Type        : 
Hair Type        : (if applicable)
Skin Concern     : 
 Hair Concern     : (if applicable)
 Age Group        : 
 Gender           :

 HOW TO USE
Step-by-step usage instructions:
1. 
2. 
3. 
(infer from product type if not explicitly mentioned)
 
 Usage Frequency  : (Daily / Weekly / As needed)
 Where to Apply   : 
 Routine Step     : (Cleanser → Toner → Serum → Moisturizer etc.)

 AMAZON LISTING DETAILS
 Optimized Title  :
(Brand + Key Ingredient + Product Type + Benefit + Size, max 200 chars)
SKU Suggestion   : BRAND-SUBTYPE-INGREDIENT-SIZE
 
 CLEAN BEAUTY CLAIMS
✅ / ❌ Paraben Free      : 
✅ / ❌ Sulphate Free     : 
✅ / ❌ Alcohol Free      : 
✅ / ❌ Fragrance Free    : 
✅ / ❌ Cruelty Free      : 
✅ / ❌ Vegan             : 
✅ / ❌ Dermatologist Tested: 
✅ / ❌ Hypoallergenic    : 
 Certifications    : (ECOCERT / COSMOS / USDA Organic / ISO / None)
 SPF               :

SAFETY INSTRUCTIONS
- For external use only
- Avoid contact with eyes. If contact occurs, rinse immediately with water
- Discontinue use if irritation, redness or allergic reaction occurs
- Patch test recommended before first use on sensitive skin
- Keep out of reach of children
- Store in a cool, dry place away from direct sunlight
- Do not use on broken or irritated skin
(add any product-specific warnings if mentioned)

 BRAND INTELLIGENCE
 Brand Name       : 
 Brand Motive     : (1-2 words: Natural / Organic / Luxury / Clinical etc.)
 Brand Tagline    : (extract or infer)
 Brand Category   : (Mass Market / Premium / Ayurvedic / K-Beauty etc.)

Based on this product, also suggest:
 
 Best Used With   : [2–3 complementary product types that pair well]
 Best Results When: [usage tip for maximum effectiveness]
 Avoid If         : [skin type or condition this may not suit]
 USP              : [single most unique thing about this product vs competitors]

IMPORTANT RULES YOU MUST ALWAYS FOLLOW
1. NEVER skip any section — always show all sections
2. NEVER make up ingredients, claims or certifications
3. If any field is truly unavailable, write "Not mentioned"
4. Always infer "How To Use" from product type if not stated
5. Always infer safety instructions from product type if not stated
6. Always generate optimized Amazon title, bullets and tags
7. Always provide AI Recommendations at the end
8. Use emojis for all section headers to improve readability
9. Present clean beauty claims with ✅ or ❌ symbols
10. Keep the tone friendly, helpful and expert — like a beauty advisor

Webpage content:
${textContent}
`;

    // Retry AI call up to 3 times
    for (let attempt = 1; attempt <= 3; attempt++) {
        try {
            const aiRes = await axios.post(
                `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
                {
                    contents: [
                        {
                            parts: [{ text: prompt }]
                        }
                    ]
                },
                {
                    headers: {
                        "Content-Type": "application/json"
                    }
                }
            );

            console.log(aiRes?.status, "statusss");

            const text = aiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!text) throw new Error("Empty AI response");

            const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();
            return JSON.parse(cleaned);
        } catch (err) {
            console.warn(`[AI] Attempt ${attempt} failed: ${err.message}`);
            if (attempt < 3) await sleep(2000 * attempt);
        }
    }

    throw new Error("AI extraction failed after 3 attempts");
}

// ─────────────────────────────────────────────
// MAIN EXPORT
// ─────────────────────────────────────────────

export default async function scrapeProduct(rawUrl) {
    let url = rawUrl.trim();

    // Add https:// if no protocol present
    if (!/^https?:\/\//i.test(url)) {
        url = "https://" + url;
    }

    // Optional: ensure it's a valid URL before even trying
    try {
        new URL(url);
    } catch {
        throw new Error(`Invalid URL: "${rawUrl}"`);
    }

    // 1. Fetch HTML with fallbacks
    const html = await fetchHtmlWithFallbacks(url);

    // 2. Extract images
    const images = extractImages(html);

    // 3. Clean text for AI
    const textContent = cleanHtmlToText(html);

    // 4. AI extraction with retry
    const result = await extractWithAI(textContent);

    // 5. Attach metadata
    result.source_images = images;
    result.source_url = url;

    return result;
}