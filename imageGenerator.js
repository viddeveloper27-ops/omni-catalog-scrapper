import axios from "axios";

export default async function generateImages(req, res) {
    try {
        const { imageBase64, numberOfImages } = req.body;

        if (!imageBase64) {
            return res.status(400).json({ error: "imageBase64 is required" });
        }

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

        const base64Data = imageBase64.includes(",")
            ? imageBase64.split(",")[1]
            : imageBase64;

        const mimeType = imageBase64.startsWith("data:image/png")
            ? "image/png"
            : "image/jpeg";

        const styles = [
            {
                name: "white-background",
                prompt: `
                    Generate the official ecommerce MAIN PRODUCT IMAGE.

                    Strict requirements:

                    Product accuracy
                    - The image must accurately represent the real product.
                    - Maintain the correct color, scale, and proportions.
                    - Do not modify the product design.

                    Background
                    - Pure white background only (RGB 255,255,255).
                    - No gradients, shadows, reflections, or textures.

                    Framing
                    - Show the entire product fully inside the frame.
                    - The product should occupy about 85–90% of the image.
                    - Center the product perfectly.

                    Content rules
                    - Show ONLY one unit of the product.
                    - Do not duplicate the product.
                    - Do not show multiple angles.
                    - No accessories unless they are included with the product.

                    Prohibited elements
                    - No text
                    - No logos
                    - No watermarks
                    - No graphics
                    - No borders
                    - No color blocks
                    - No promotional elements

                    Styling
                    - Clean professional studio lighting.
                    - Neutral commercial product photography style.
                    - The result should look like a real catalog product photo used for ecommerce listings.
                `
            },
            {
                name: "lifestyle",
                prompt: "Place this product in a realistic lifestyle scene showing natural use.",
            },
            {
                name: "creative",
                prompt: "Create a premium promotional advertisement image using bold composition and colors.",
            },
            {
                name: "model-usage",
                prompt: `
                    Generate a professional ecommerce lifestyle image featuring a human model using this product.

                    Requirements:
                    - Include a realistic human model interacting naturally with the product
                    - The product must remain clearly visible and unchanged
                    - The model should appear natural and authentic
                    - Use soft professional lighting
                    - Environment should feel modern and clean
                    - The product must remain the main focus of the image
                `,
            },
            {
                name: "close-up-detail",
                prompt: `
                    Generate a professional macro close-up image highlighting the product details.

                    Requirements:
                    - Focus on important textures, materials, or craftsmanship of the product
                    - Show a close-up perspective of the product
                    - Maintain realistic colors and accurate materials
                    - Use soft studio lighting to highlight fine details
                    - Background should be clean and minimal
                    - The product must remain the main focus
                `
            },
            {
                name: "benefits-highlight",
                prompt: `
                    Generate a professional ecommerce marketing image that visually demonstrates the key benefits of this product.

                    Requirements:
                    - Show the product being used in a way that clearly communicates its main benefit or value.
                    - The benefit should be visually obvious through the scene, interaction, or outcome.
                    - Do not add any text, labels, or graphics explaining the benefit.
                    - The product must remain clearly visible and unchanged.
                    - Use natural lighting and a clean modern environment.
                    - The product should remain the main focus of the image.
                    - The scene should feel realistic and relatable to everyday product use.
                    - Composition should clearly emphasize why the product is useful or desirable.
                `
            },
            {
                name: "environment-context",
                prompt: `
                    Generate a realistic contextual scene where the product naturally belongs.

                    Requirements:
                    - Place the product in a realistic environment related to its use
                    - The scene should feel authentic and natural
                    - Lighting should match the environment
                    - The product must remain clearly visible and in focus
                    - Do not overpower the product with background elements
                `
            }
        ];

        const tempStyles = styles.slice(0, numberOfImages || styles.length);

        // ── Set up SSE (Server-Sent Events) streaming ──
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.flushHeaders();

        const sendEvent = (data) => {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
            // Flush if available (for compression middleware compatibility)
            if (typeof res.flush === "function") res.flush();
        };

        let generatedCount = 0;

        for (const style of tempStyles) {
            try {
                const aiResponse = await callGeminiWithRetry({
                    url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
                    body: {
                        contents: [
                            {
                                parts: [
                                    { text: style.prompt },
                                    { inlineData: { mimeType, data: base64Data } },
                                ],
                            },
                        ],
                    },
                    config: { headers: { "Content-Type": "application/json" } },
                });

                const parts = aiResponse.data?.candidates?.[0]?.content?.parts || [];

                for (const part of parts) {
                    if (part.inlineData?.data) {
                        generatedCount++;
                        // Stream each image immediately as it's ready
                        sendEvent({
                            type: "image",
                            index: generatedCount - 1,
                            styleName: style.name,
                            image: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`,
                            total: tempStyles.length,
                        });
                    }
                }
            } catch (err) {
                console.warn(`[generateImages] Style "${style.name}" failed: ${err.message}`);
                // Send error for this style but continue with others
                sendEvent({
                    type: "error",
                    styleName: style.name,
                    message: err.message,
                });
            }
        }

        // Signal completion
        sendEvent({ type: "done", total: generatedCount });
        res.end();
    } catch (err) {
        console.error(err);
        // If headers not sent yet, send JSON error; otherwise stream it
        if (!res.headersSent) {
            res.status(500).json({ success: false, error: err.message });
        } else {
            res.write(`data: ${JSON.stringify({ type: "error", message: err.message })}\n\n`);
            res.end();
        }
    }
}

async function callGeminiWithRetry(payload, maxRetries = 3) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const res = await axios.post(payload.url, payload.body, payload.config);
            return res;
        } catch (err) {
            const status = err.response?.status;
            if (status === 429 && attempt < maxRetries) {
                const delay = 2000 * attempt;
                console.warn(`Gemini rate limit. Retry ${attempt} in ${delay}ms`);
                await new Promise(r => setTimeout(r, delay));
                continue;
            }
            throw err;
        }
    }
}