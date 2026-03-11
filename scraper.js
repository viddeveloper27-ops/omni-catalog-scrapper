import axios from "axios";
import * as cheerio from "cheerio";
import dotenv from "dotenv";
import puppeteer from "puppeteer";

dotenv.config();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

function upgradeToFullRes(url) {
    return url.replace(/\._[A-Za-z0-9_,]+_\./g, ".");
}

function dedupe(images) {
    return [...new Set(images)];
}

export default async function scrapeProduct(url) {

    const browser = await puppeteer.launch({
        headless: "new",
        args: [
            "--no-sandbox",
            "--disable-setuid-sandbox",
            "--disable-dev-shm-usage",
            "--disable-gpu"
        ]
    });

    const page = await browser.newPage();

    await page.goto(url, { waitUntil: "domcontentloaded" });

    const html = await page.content();

    const $ = cheerio.load(html);

    const extractedImages = [];

    const dynamicRegex = /data-a-dynamic-image=["']({[^"']+})["']/g;

    let match;

    while ((match = dynamicRegex.exec(html)) !== null) {

        const json = JSON.parse(match[1].replace(/&quot;/g, '"'));

        for (const img of Object.keys(json)) {
            extractedImages.push(upgradeToFullRes(img));
        }
    }

    const images = dedupe(extractedImages).slice(0, 5);

    const textContent = html
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 15000);


    const prompt = `
You are an expert ecommerce content writer and Amazon listing specialist.

Analyze the following webpage content from a product listing URL and extract comprehensive product data in JSON format:

{
"title": "SEO-optimized product title (max 200 chars)",
"bullets": ["5 concise bullet highlights for the product listing"],
"description": "Concise product description (300-500 chars). 2-3 short sentences covering what it is, key features, and who it's for.",
"tags": ["15-20 relevant Amazon backend search terms"],
"sku_suggestion": "Suggested SKU based on product type and brand",
"brand_motive": "Brand positioning in 1-2 words",
"brand_name": "Extract brand name",
"brand_tagline": "Extract or infer brand tagline",
"category": "Best fitting Amazon Browse Node category path",
"ingredients": [],
"safety_instructions": [],
"material": "",
"weight": "",
"dimensions": "",
"target_audience": "",
"key_benefits": [],
"product_dimensions": "",
"item_weight": "",
"manufacturer": "",
"asin": "",
"item_model_number": "",
"country_of_origin": "",
"department": "",
"packer": "",
"net_quantity": "",
"generic_name": "",
"date_first_available": "",
"is_discontinued": "",
"colour": "",
"heel_type": "",
"toe_style": "",
"style_name": "",
"pattern": "",
"season": "",
"closure_type": "",
"sport_type": "",
"shoe_type": "",
"water_resistance_level": "",
"sole_material": "",
"outer_material": "",
"inner_material": ""
}

IMPORTANT RULES:
- Extract ALL product details if present in the HTML
- Check "Product Details", "Technical Details", "Additional Information"
- Return ONLY valid JSON
- Do NOT include markdown
- Do NOT explain anything

Webpage content:
${textContent}
`;

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

    const aiData = aiRes.data;

    const text = aiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    const cleaned = text.replace(/```json/g, "").replace(/```/g, "").trim();

    const result = JSON.parse(cleaned);

    result.source_images = images;
    result.source_url = url;

    return result;
}