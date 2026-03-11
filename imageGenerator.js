import axios from "axios";

export default async function generateImages(req, res) {
    try {
        const { imageBase64 } = req.body;

        if (!imageBase64) {
            return res.status(400).json({
                error: "imageBase64 is required",
            });
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
                prompt:
                    "Place this product in a realistic lifestyle scene showing natural use.",
            },
            {
                name: "creative",
                prompt:
                    "Create a premium promotional advertisement image using bold composition and colors.",
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
            }
        ];

        const images = [];

        for (const style of styles) {
            const aiResponse = await callGeminiWithRetry({
                url: `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
                body: {
                    contents: [
                        {
                            parts: [
                                { text: style.prompt },
                                {
                                    inlineData: {
                                        mimeType,
                                        data: base64Data,
                                    },
                                },
                            ],
                        },
                    ],
                },
                config: {
                    headers: { "Content-Type": "application/json" },
                }
            });

            const parts = aiResponse.data?.candidates?.[0]?.content?.parts || [];

            for (const part of parts) {
                if (part.inlineData?.data) {
                    images.push(
                        `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                    );
                }
            }
        }

        return res.json({
            success: true,
            images,
        });
    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message,
        });
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