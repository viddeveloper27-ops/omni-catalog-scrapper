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
                    Generate a professional ecommerce product image.

                    Requirements:
                    - Pure white background
                    - Product centered
                    - Product occupies at least 85% of frame
                    - No props
                    - No shadows
                    - Clean studio lighting
                `,
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