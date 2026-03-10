import fetch from "node-fetch";

export default async function generateImage(req, res) {
    try {
        const { imageBase64, style } = req.body;

        if (!imageBase64 || !style) {
            return res.status(400).json({
                error: "imageBase64 and style are required"
            });
        }

        const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

        if (!GEMINI_API_KEY) {
            return res.status(500).json({
                error: "Gemini API key not configured"
            });
        }

        let stylePrompt;

        if (style === "white-background") {
            console.log("first imageeeee")
            stylePrompt = `
                Generate a professional ecommerce product image.

                Requirements:
                - Pure white studio background (#FFFFFF)
                - Product centered in the frame
                - Product must occupy about 80% of the image area
                - Small even white margin around the product
                - Soft studio lighting
                - No props, no shadows, no reflections
                - Product must remain exactly unchanged

                Output a clean ecommerce-ready product photo.
                `;
        }
        else if (style === "lifestyle") {
            stylePrompt =
                "Place this product in a realistic lifestyle scene showing it naturally used in an appealing environment.";
        }
        else {
            stylePrompt =
                "Create a premium promotional advertisement image using this product with bold colors and creative composition.";
        }

        const base64Data = imageBase64.includes(",")
            ? imageBase64.split(",")[1]
            : imageBase64;

        const mimeType = imageBase64.startsWith("data:image/png")
            ? "image/png"
            : "image/jpeg";

        const aiResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${GEMINI_API_KEY}`,
            {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    contents: [
                        {
                            parts: [
                                { text: stylePrompt },
                                {
                                    inlineData: {
                                        mimeType,
                                        data: base64Data
                                    }
                                }
                            ]
                        }
                    ]
                })
            }
        );

        const aiData = await aiResponse.json();

        const images = [];

        const parts =
            aiData?.candidates?.[0]?.content?.parts || [];

        for (const part of parts) {
            if (part.inlineData?.data) {
                images.push(
                    `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`
                );
            }
        }

        res.json({
            success: true,
            images
        });

    } catch (err) {
        console.error("Image generation error:", err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
}