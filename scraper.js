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

let browser;

export default async function scrapeProduct(url) {

    try {
        const browser = await puppeteer.launch({
            headless: "new",
            protocolTimeout: 60000,   // ← key fix: 60s timeout for CDP calls
            args: [
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-gpu"
            ]
        });

        const page = await browser.newPage();

        await page.goto(url, {
            waitUntil: "domcontentloaded",
            timeout: 60000
        });

        await new Promise(res => setTimeout(res, 2000));

        const html = await page.content();

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
 
 You are an expert ecommerce content writer and Amazon listing optimization specialist.
  
 Analyze the following webpage content from a product listing URL and extract structured product data suitable for creating a high-converting Amazon listing.
  
 The product can belong to ANY category such as fashion, shoes, beauty, electronics, toys, home, gifts, kitchen, etc. Adapt attributes dynamically depending on the product type.
  
 Return structured data in the following JSON format:
  
 {
 
 "title": "SEO optimized Amazon product title (max 200 characters including brand, product type, key features, and size/variant if available)",
  
 "about_the_item": [
 
 "5 Amazon bullet points. Each bullet must start with a FEATURE TITLE IN CAPS followed by a short benefit explanation."
 
 ],
  
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
 
 - Look carefully in sections such as:
 
   - Product Details
 
   - Technical Details
 
   - Additional Information
 
   - About This Item
 
   - Product Description
 
 - If a field is not available, return an empty string "" or empty array [].
 
 - Do NOT hallucinate unknown values.
 
 - Optimize the title and bullets using Amazon SEO best practices.
 
 - Bullet points must highlight key product benefits and features.
 
 - Return ONLY valid JSON.
 
 - Do NOT include markdown formatting.
 
 - Do NOT explain anything.
  
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
    } catch (error) {
        console.error("Error occurred while scraping:", error);
    } finally {
        if (browser) await browser.close();
    }
}