const express = require("express");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();
const http = require("http");
const fs = require("fs");

const app = express();
const ws = require("ws");

const port = 3003;
const db = new sqlite3.Database("./data.db");

const secrets = require("./secrets.js");
const SECRET_KEY = secrets.SECRET_KEY;
const OPENAI_KEY = secrets.OPENAI_KEY;

const openai = require("openai");
const openAiInstance = new openai({apiKey: OPENAI_KEY});
const prompt = fs.readFileSync("./prompt.txt", "utf8");

const authenticate = (req, res, next) => {
    const apiKey = req.headers["x-api-key"];

    // No need to authenticate if the call is coming from localhost
    const isLocal =
        req.connection.remoteAddress === "localhost" ||
        req.connection.remoteAddress === "::1" ||
        req.connection.remoteAddress === "::ffff" ||
        req.connection.remoteAddress === "::ffff:127.0.0.1";

    if (isLocal || (apiKey && apiKey === SECRET_KEY)) {
        next(); // Key is correct, proceed to the route
    } else {
        res.status(401).json({error: "Unauthorized"});
    }
};

app.use(bodyParser.json());

// Serve static files in /dist
app.use(express.static("dist"));

// Require auth for the rest of the endpoints
app.use(authenticate);

// CREATE
app.post("/items", (req, res) => {
    const itemsArray = req.body.items;

    if (!Array.isArray(itemsArray)) {
        return res.status(400).json({error: "Invalid input format"});
    }

    db.serialize(() => {
        db.run("BEGIN TRANSACTION");

        const sql =
            "INSERT INTO items (name, calories_low, fat_low, carbs_low, protein_low, calories, fat, carbs, protein, calories_high, fat_high, carbs_high, protein_high, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
        let errorOccurred = false;
        let insertedCount = 0; // Track the number of successful inserts

        // Using a traditional for-loop to allow breaking out
        for (let i = 0; i < itemsArray.length; i++) {
            const item = itemsArray[i];
            const params = [
                item.name,
                item.calories_low,
                item.fat_low,
                item.carbs_low,
                item.protein_low,
                item.calories,
                item.fat,
                item.carbs,
                item.protein,
                item.calories_high,
                item.fat_high,
                item.carbs_high,
                item.protein_high,
                item.consumed_at,
            ];

            db.run(sql, params, function (err) {
                if (err) {
                    console.error(err.message);
                    errorOccurred = true;
                } else {
                    insertedCount++;
                    console.log(
                        `${item.name}: ${item.calories} calories, ${item.fat}g of fat, ${item.carbs}g of carbs, ${item.protein}g of protein.  Consumed at ${item.consumed_at}`
                    );
                }

                // Check if all inserts have completed
                if (insertedCount === itemsArray.length) {
                    if (errorOccurred) {
                        db.run("ROLLBACK");
                        res.status(500).json({error: "An error occurred while inserting items"});
                    } else {
                        db.run("COMMIT");
                        res.status(201).json({message: "All items inserted successfully"});
                    }
                }
            });
        }
    });
});

// READ
app.get("/items", (req, res) => {
    db.all("SELECT * FROM items ORDER BY consumed_at DESC", [], (err, rows) => {
        if (err) {
            res.status(500).json({error: err.message});
            return;
        }
        res.status(200).json({data: rows});
    });
});

app.get("/items/today", (req, res) => {
    const today = new Date();
    const dateString = today.toISOString().split("T")[0]; // Format as 'YYYY-MM-DD'

    const sql = "SELECT * FROM items WHERE DATE(consumed_at) >= ? ORDER BY consumed_at DESC";

    db.all(sql, [dateString], (err, rows) => {
        if (err) {
            res.status(500).json({error: err.message});
            return;
        }
        res.status(200).json({data: rows});
    });
});

app.get("/items/last7days", (req, res) => {
    // Get the current date and time
    const today = new Date();

    // Subtract 7 days from the current date
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(today.getDate() - 7);

    // Format dates to 'YYYY-MM-DD'
    const sevenDaysAgoString = sevenDaysAgo.toISOString().split("T")[0];

    const sql = "SELECT * FROM items WHERE DATE(consumed_at) >= ? ORDER BY consumed_at DESC";

    db.all(sql, [sevenDaysAgoString], (err, rows) => {
        if (err) {
            res.status(500).json({error: err.message});
            return;
        }
        res.status(200).json({data: rows});
    });
});

// READ
app.get("/items", (req, res) => {
    db.all("SELECT * FROM items", [], (err, rows) => {
        if (err) {
            res.status(500).json({error: err.message});
            return;
        }
        res.status(200).json({data: rows});
    });
});

// UPDATE
app.put("/items/:id", (req, res) => {
    const {id} = req.params;
    const {name} = req.body;
    db.run("UPDATE items SET name = ? WHERE id = ?", [name, id], function (err) {
        if (err) {
            res.status(500).json({error: err.message});
            return;
        }
        res.status(200).json({message: `Row(s) updated: ${this.changes}`});
    });
});

// DELETE
app.delete("/items/:id", (req, res) => {
    const {id} = req.params;
    db.run("DELETE FROM items WHERE id = ?", id, function (err) {
        if (err) {
            res.status(500).json({error: err.message});
            return;
        }
        res.status(200).json({message: `Row(s) deleted: ${this.changes}`});
    });
});

// Submit to OpenAI API and stream results back
async function sendAndStream(ws, message) {
    const date = new Date(2024, 0, 30);
    const formattedDate = date.toISOString().split("T")[0];

    const currentPrompt = prompt.replace("{{date}}", formattedDate);
    const requestData = {
        model: "gpt-4",
        messages: [{role: "user", content: currentPrompt + "\n" + message}],
        stream: true,
    };

    const stream = await openAiInstance.beta.chat.completions.stream(requestData);

    // Begin by collecting the JSON response.  Once this is completed, we will stream the results back to the client.
    let jsonString = "";
    stream
        .on("content", data => {
            if (jsonString === false) {
                ws.send(JSON.stringify({type: "message", data}));
            } else {
                jsonString += data;
                try {
                    const json = JSON.parse(jsonString);
                    // Send the JSON response to the client
                    ws.send(JSON.stringify({type: "data", data: json}));
                    jsonString = false;
                    recordData(json);
                } catch (error) {
                    // JSON parsing failed, so we are still receiving data
                }
            }
        })
        .on("end", () => {
            console.log("Stream ended"); // End of streaming
            ws.send(JSON.stringify({type: "end"}));
        })
        .on("error", error => {
            console.error("Error:", error.message); // Handle errors
            ws.send(JSON.stringify({type: "error", data: error.message}));
        });
}

// Record the data in the database
function recordData(obj) {
    const params = [
        obj.name,
        obj.calories_low,
        obj.fat_low,
        obj.carbs_low,
        obj.protein_low,
        obj.calories,
        obj.fat,
        obj.carbs,
        obj.protein,
        obj.calories_high,
        obj.fat_high,
        obj.carbs_high,
        obj.protein_high,
        obj.consumed_at,
    ];

    const sql =
        "INSERT INTO items (name, calories_low, fat_low, carbs_low, protein_low, calories, fat, carbs, protein, calories_high, fat_high, carbs_high, protein_high, consumed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

    db.run(sql, params, function (err) {
        if (err) {
            console.error(err.message);
        } else {
            console.log(
                `${obj.name}: ${obj.calories} calories, ${obj.fat}g of fat, ${obj.carbs}g of carbs, ${obj.protein}g of protein.  Consumed at ${obj.consumed_at}`
            );
        }
    });
}

// Start the server
const server = http.createServer(app);

const wss = new ws.WebSocketServer({server: server});

wss.on("connection", function (ws) {
    ws.on("message", function (message) {
        sendAndStream(ws, message.toString());
        console.log("received: %s", message);
    });
});

server.listen(port, () => console.log(`Listening on port ${port}`));
