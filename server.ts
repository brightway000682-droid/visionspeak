import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dbPath = process.env.NODE_ENV === "production" ? "/tmp/visionspeak.db" : "visionspeak.db";
const db = new Database(dbPath);

// Initialize DB
db.exec(`
  CREATE TABLE IF NOT EXISTS words (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word TEXT NOT NULL,
    context_sentence TEXT,
    meaning TEXT,
    phonetic_us TEXT,
    phonetic_uk TEXT,
    image_url TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS progress (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    word_id INTEGER,
    status TEXT DEFAULT 'new',
    last_reviewed DATETIME,
    next_review DATETIME,
    FOREIGN KEY(word_id) REFERENCES words(id)
  );
`);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API Routes
  app.get("/api/words", (req, res) => {
    const words = db.prepare("SELECT * FROM words ORDER BY created_at DESC").all();
    res.json(words);
  });

  app.post("/api/words", (req, res) => {
    const { word, context_sentence, meaning, phonetic_us, phonetic_uk, image_url } = req.body;
    const info = db.prepare(`
      INSERT INTO words (word, context_sentence, meaning, phonetic_us, phonetic_uk, image_url)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(word, context_sentence, meaning, phonetic_us, phonetic_uk, image_url);
    
    db.prepare("INSERT INTO progress (word_id, next_review) VALUES (?, datetime('now'))").run(info.lastInsertRowid);
    
    res.json({ id: info.lastInsertRowid });
  });

  app.get("/api/stats", (req, res) => {
    const totalWords = db.prepare("SELECT COUNT(*) as count FROM words").get();
    res.json({ totalWords: totalWords.count });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, "dist")));
    app.get("*", (req, res) => {
      res.sendFile(path.resolve(__dirname, "dist", "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

if (process.env.NODE_ENV !== "production") {
  startServer();
}

export default startServer;
