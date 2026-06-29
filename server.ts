import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const PORT = 3000;

// Parse JSON payloads
app.use(express.json({ limit: "50mb" }));

// Initialize Gemini API Client server-side
const apiKey = process.env.GEMINI_API_KEY;
let ai: GoogleGenAI | null = null;

if (apiKey) {
  ai = new GoogleGenAI({
    apiKey: apiKey,
    httpOptions: {
      headers: {
        "User-Agent": "aistudio-build",
      },
    },
  });
}

// 1. API: Server health check
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", geminiConfigured: !!apiKey });
});

// 2. API: ML-Assisted EEG Clinical Interpretation
app.post("/api/gemini/analyze", async (req, res) => {
  try {
    if (!ai) {
      return res.status(500).json({
        error: "Gemini API is not configured. Please add GEMINI_API_KEY to the secrets panel in Settings.",
      });
    }

    const { scenarioName, activeState, bandPowers, globalMetrics, userPrompt, preprocessing, artifacts } = req.body;

    const systemInstruction = `
      You are an expert Clinical Neurophysiologist and AI/ML Brain-Computer Interface (BCI) Engineer.
      Your goal is to interpret EEG signal summaries, spectral features, artifact statistics, and pipeline results.
      Provide detailed, professional, and accessible clinical and engineering commentaries in clear Markdown format.
      Always maintain clinical precision, explaining physiological relevance of bands (Delta, Theta, Alpha, Beta, Gamma) and artifact detection.
    `;

    const prompt = `
      Perform a professional interpretation of the current EEG recording:
      - **EEG Recording Scenario**: ${scenarioName}
      - **Current Segment State**: ${activeState}
      - **Global Signal Metrics**:
        * Est. Heart Rate: ${globalMetrics?.averageHeartRate || "N/A"} BPM
        * Transient Blinks: ${globalMetrics?.blinkCount || 0} occurrences
        * Noise Floor RMS: ${globalMetrics?.noiseLevel || 5} uV
        * Artifact Interference Ratio: ${Math.round((globalMetrics?.overallArtifactRatio || 0) * 100)}%
      - **Pipeline Configuration**:
        * Preprocessing: Notch filter (${preprocessing?.notchFilter ? "ON" : "OFF"}), Bandpass (${preprocessing?.bandpassEnabled ? `${preprocessing?.bandpassMin}-${preprocessing?.bandpassMax} Hz` : "OFF"}), Re-referencing: ${preprocessing?.reReferencing}
        * Artifact Cleaning: Method (${artifacts?.method}), Eye blinks (${artifacts?.detectEyeBlinks ? "ON" : "OFF"}), Muscle noise (${artifacts?.detectMuscle ? "ON" : "OFF"})
      - **Electrode Spectral Band Powers (Average uV^2)**:
        ${JSON.stringify(bandPowers, null, 2)}

      ${userPrompt ? `**User Query / Area of Interest**: "${userPrompt}"` : "Please generate a comprehensive review of this signal segment, detailing the clinical indicators, the state of the brainwaves (frequency bands dominance), and the success/validity of the preprocessing and artifact filtering pipeline."}
    `;

    const response = await ai.models.generateContent({
      model: "gemini-3.5-flash",
      contents: prompt,
      config: {
        systemInstruction,
        temperature: 0.7,
      },
    });

    const reportText = response.text || "No report could be generated.";
    res.json({ report: reportText });
  } catch (error: any) {
    console.error("Gemini analysis error:", error);
    res.status(500).json({ error: error.message || "An error occurred during AI analysis." });
  }
});

// Vite Middleware for Asset Pipeline / SPA Routing
async function setupVite() {
  if (process.env.NODE_ENV !== "production") {
    console.log("Starting server in DEVELOPMENT mode with Vite middleware...");
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    console.log("Starting server in PRODUCTION mode...");
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

setupVite().catch((err) => {
  console.error("Failed to start server:", err);
});
