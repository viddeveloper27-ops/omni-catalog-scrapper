import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import scrapeProduct from "./scraper2.js";
import generateImage from "./imageGenerator.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json({ limit: "20mb" }));

// AMAZON SCRAPER
app.post("/scrape", async (req, res) => {
    try {
        const { url } = req.body;

        if (!url) {
            return res.status(400).json({ error: "URL required" });
        }

        const data = await scrapeProduct(url);

        res.json({
            success: true,
            data
        });

    } catch (err) {
        console.error(err);

        res.status(500).json({
            success: false,
            error: err.message
        });
    }
});

// IMAGE GENERATION
app.get("/", (req, res) => {
    res.send("hello");
});
app.post("/generate-image", generateImage);

app.listen(3000, () => {
    console.log("API server running on port 3000");
});