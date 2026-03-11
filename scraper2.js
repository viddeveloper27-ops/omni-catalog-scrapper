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
You are an expert ecommerce content writer and Amazon listing optimization specialist.
 
Analyze the following webpage content from a product listing URL and extract structured product data suitable for creating a high-converting Amazon listing.
 
The product can belong to ANY category such as fashion, shoes, beauty, electronics, toys, home, gifts, kitchen, etc. Adapt attributes dynamically depending on the product type.
 
Return structured data in the following JSON format:
 
{
"title": "SEO optimized Amazon product title (max 200 characters including brand, product type, key features, and size/variant if available)",
"about_the_item": ["5 Amazon bullet points. Each bullet must start with a FEATURE TITLE IN CAPS followed by a short benefit explanation."],
"description": "Concise product description (300-500 characters). 2-3 short sentences describing what the product is, its key features, and who it is for.",
"tags": ["15-20 Amazon backend search keywords based on buyer intent"],
"sku_suggestion": "Suggested SKU based on brand, category, and product type",
"brand_name": "Extract brand name if present",
"brand_tagline": "Extract or infer brand tagline if available",
"brand_motive": "Brand positioning summarized in 1-2 words",
"category": "Best matching Amazon category path",
"product_type": "",
"material": "",
"ingredients": [],
"key_benefits": [],
"safety_instructions": [],
"target_audience": "",
"special_features": [],
"colour": "",
"pattern": "",
"style_name": "",
"season": "",
"dimensions": "",
"product_dimensions": "",
"item_weight": "",
"weight": "",
"net_quantity": "",
"manufacturer": "",
"packer": "",
"country_of_origin": "",
"generic_name": "",
"asin": "",
"item_model_number": "",
"department": "",
"date_first_available": "",
"is_discontinued": "",
"technical_attributes": {
  "heel_type": "",
  "toe_style": "",
  "closure_type": "",
  "sport_type": "",
  "shoe_type": "",
  "water_resistance_level": "",
  "sole_material": "",
  "outer_material": "",
  "inner_material": ""
}
}
 
IMPORTANT RULES:
- Extract ALL available product information from the webpage content.
- If a field is not available, return an empty string "" or empty array [].
- Do NOT hallucinate unknown values.
- Optimize the title and bullets using Amazon SEO best practices.
- Return ONLY valid JSON. No markdown, no explanation.
 
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

export default async function scrapeProduct(url) {
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