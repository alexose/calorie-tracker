const sqlite3 = require("sqlite3").verbose();
const db = new sqlite3.Database("./data.db");

db.serialize(() => {
    // Create items table
    db.run(
        `CREATE TABLE items (
            id INTEGER PRIMARY KEY,
            session_token TEXT NOT NULL,
            name TEXT NOT NULL,
            calories_low REAL NOT NULL,
            fat_low REAL NOT NULL,
            carbs_low REAL NOT NULL,
            protein_low REAL NOT NULL,
            calories REAL NOT NULL,
            fat REAL NOT NULL,
            carbs REAL NOT NULL,
            protein REAL NOT NULL,
            calories_high REAL NOT NULL,
            fat_high REAL NOT NULL,
            carbs_high REAL NOT NULL,
            protein_high REAL NOT NULL,
            consumed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );`
    );

    // Create sessions table
    db.run(
        `CREATE TABLE sessions (
            id INTEGER PRIMARY KEY,
            token TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            calorie_target REAL,
            protein_target REAL,
            fat_target REAL,
            carbs_target REAL
        );`
    );
});
db.close();
