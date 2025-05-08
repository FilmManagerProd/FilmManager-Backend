process.noDeprecation = true;

require("dotenv").config();

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY)

const express = require("express");
const cors = require("cors");

const { createServer } = require("http");
const { Server } = require("socket.io");

const admin = require("firebase-admin");

const Utilities = require("./services/Utilities");

const DM = require("./services/DatabaseManager");

const FirebaseDecoder = require("./services/FirebaseDecoder");

const port = process.env.PORT || 3000;

const app = express();

const httpServer = createServer(app);

const io = new Server(httpServer, {
    path: "/socket.io",
    cors: {
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
    },
});

const authMiddleware = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(400).json({ error: 'UERROR: Missing authorization token.' });
        }

        const token = authHeader.split(' ')[1];

        const decodedToken = await admin.auth().verifyIdToken(token);

        req.user = decodedToken;

        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(401).json({ error: 'UERROR: Invalid or expired token.' });
    }
};

const securityMiddleware = async (req, res, next) => {
    try {
        const apiKey = req.headers.api_key;

        if (!apiKey) {
            return res.status(400).json({ error: 'UERROR: Missing API Key.' });
        }

        if (apiKey !== process.env.API_KEY) {
            return res.status(401).json({ error: 'UERROR: Invalid API Key.' });
        }

        next();
    } catch (error) {
        console.error('Authentication error:', error);
        res.status(401).json({ error: 'UERROR: Invalid API Key.' });
    }
}

app.use(
    cors({
        origin: "*",
        methods: ["GET", "POST", "PUT", "DELETE"],
    })
);

app.use(express.json({ limit: '10mb' }));

app.get("/", (req, res) => {
    res.send("Server healthy!");
});

app.get('/api/user', authMiddleware, securityMiddleware, async (req, res) => {
    try {
        const userData = DM.peek(['Users', req.user.uid]);

        if (!userData) return res.status(404).json({ error: 'UERROR: User not found' });

        res.json(userData);
    } catch (error) {
        console.log(`\n[API] - FAILED: /api/user GET - ${error.stack || error}\n`);
        res.status(500).json({ error: 'ERROR: Failed to fetch user data' });
    }
});

app.post('/api/redeem', authMiddleware, securityMiddleware, async (req, res) => {
    try {
        const { items } = req.body;
        const user = DM.peek(['Users', req.user.uid]);

        if (!user) {
            return res.status(404).json({ error: 'UERROR: User not found. Please try logging in again.' });
        }

        if (items.length === 0) {
            return res.status(400).json({ error: 'UERROR: No items checked-out for purchase.' });
        }

        let total = 0;
        const validatedItems = [];

        for (const item of items) {
            const product = DM.peek(['Barcodes', item.id]);

            if (!product) {
                return res.status(400).json({ error: `UERROR: One or more items could not found.` });
            }

            if (product.totalCount < item.quantity) {
                return res.status(400).json({ error: `UERROR: Insufficient stock.` });
            }

            total += product.pointsToRedeem * item.quantity;
            validatedItems.push({
                productId: item.id,
                productName: product.itemName,
                productGroup: product.group,
                quantity: item.quantity
            });
        }

        if (total > user.points) {
            return res.status(400).json({ error: 'UERROR: Insufficient points to complete purchase.' });
        }

        user.points -= total;

        user.redemptions = user.redemptions || {};

        for (const item of validatedItems) {
            if (user.redemptions[item.productId]) {
                user.redemptions[item.productId].quantity += item.quantity;
            } else {
                user.redemptions[item.productId] = { ...item };
            }
        }

        DM['Users'][req.user.uid] = user;

        for (const item of validatedItems) {
            const product = DM.peek(['Barcodes', item.productId]);
            product.totalCount -= item.quantity;
            DM['Barcodes'][item.productId] = product;
        }

        await DM.save();

        res.status(200).json({
            message: "SUCCESS: Registration successful.",
            result: user.points
        });

    } catch (error) {
        console.log(`\n[API] - FAILED: /api/redeem POST - ${error.stack || error}\n`);
        res.status(500).json({ error: 'ERROR: Checkout failed' });
    }
});

app.get('/api/users', authMiddleware, securityMiddleware, async (req, res) => {
    try {
        // Verify admin privileges
        const requestingUser = DM.peek(['Users', req.user.uid]);
        if (!requestingUser || requestingUser.role !== 'Admin') {
            return res.status(403).json({ error: 'UERROR: Unauthorized access.' });
        }

        const users = DM.peek(['Users']) || {};
        const userList = Object.values(users).filter(user => user.role !== 'Admin');

        res.status(200).json({
            message: "SUCCESS: Users fetched successfully.",
            result: userList
        });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ error: 'ERROR: Failed to fetch users.' });
    }
});

app.delete('/api/users/:email', authMiddleware, securityMiddleware, async (req, res) => {
    try {
        const requestingUser = DM.peek(['Users', req.user.uid]);
        if (!requestingUser || requestingUser.role !== 'Admin') {
            return res.status(403).json({ error: 'UERROR: Unauthorized access.' });
        }

        const userEmail = req.params.email;

        const userId = Object.keys(DM.peek(['Users'])).find(userId => DM.peek(['Users', userId]).email === userEmail);

        const userToDelete = DM.peek(['Users', userId]);

        if (!userToDelete) {
            return res.status(404).json({ error: 'UERROR: User not found.' });
        }

        if (userToDelete.role === 'Admin') {
            return res.status(403).json({ error: 'UERROR: Cannot delete admin users.' });
        }

        await admin.auth().deleteUser(userId);

        DM.destroy(['Users', userId]);
        await DM.save();

        res.status(200).json({ message: 'SUCCESS: User deleted successfully.' });
    } catch (error) {
        console.error('Error deleting user:', error);
        res.status(500).json({ error: 'ERROR: Failed to delete user.' });
    }
});

app.post('/api/register', async (req, res) => {
    const { email, password, username } = req.body;

    if (!email || !password || !username) {
        return res.status(400).json({
            error: 'UERROR: Please fill in all required fields.'
        });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
        return res.status(400).json({
            error: 'UERROR: Please enter a valid email address.'
        });
    }

    const passwordRegex = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>]).{12,}$/;
    if (!passwordRegex.test(password)) {
        return res.status(400).json({
            error: 'UERROR: Password must be at least 12 characters long and contain at least one uppercase letter, one number, and one special character.'
        });
    }

    const users = DM.peek(['Users']);

    if (users) {
        const existingUserWithUsername = Object.values(users).find(
            (user) => user.username && user.username.toLowerCase() === username.toLowerCase()
        );

        if (existingUserWithUsername) {
            return res.status(400).json({
                error: 'UERROR: Username already taken.'
            });
        }
    }

    let existingUser = null;

    try {
        existingUser = await admin.auth().getUserByEmail(email);
    } catch (error) {
        existingUser = null;
    }

    if (existingUser) {
        return res.status(400).json({
            error: 'UERROR: Email already taken.'
        });
    }

    try {
        const userRecord = await admin.auth().createUser({
            email,
            password,
            displayName: username
        });

        DM['Users'][userRecord.uid] = {
            username,
            email,
            role: "User",
            points: 0,
            redemptions: [],
            createdAt: Date.now()
        };

        await DM.save();

        res.status(200).json({
            message: "SUCCESS: Registration successful.",
            result: userRecord.uid
        });

    } catch (error) {
        console.log("ERROR: " + FirebaseDecoder(error.message));
        return res.status(500).json({
            error: "ERROR: " + FirebaseDecoder(error.message)
        });
    }
});

app.get("/api/barcodes", securityMiddleware, async (req, res) => {
    console.log(`\n[API] - GET: /api/barcodes\n`);
    try {
        const barcodes = DM.peek(["Barcodes"]);

        const barcodeList = Array.isArray(barcodes)
            ? barcodes
            : typeof barcodes === "object" && barcodes !== null
            ? Object.values(barcodes)
            : [];

        res.status(200).json({
            message: "SUCCESS: Data fetched successfully.",
            result: barcodeList,
        });
    } catch (error) {
        console.log(`\n[API] - FAILED: /api/barcodes GET - ${error.stack || error}\n`);
        res.status(500).json({ error: "ERROR: Failed to fetch data." });
    }
});

app.post("/api/barcodes", securityMiddleware, async (req, res) => {
    console.log(`\n[API] - POST: /api/barcodes\n`);
    try {
        const barcodes = Array.isArray(req.body) ? req.body : [req.body];
        const now = new Date().toISOString();
        const updatedBy = req?.user?.name || req?.user?.email || req?.user?.uid || "Unknown";

        const successes = [];
        const errors = [];

        for (const [index, b] of barcodes.entries()) {
            const {
                barcode, itemName, itemDescription,
                count, group, location, pointsToRedeem
            } = b;

            // Validate
            const isValid =
                (typeof barcode === "string") &&
                (typeof itemName === "string") &&
                (typeof itemDescription === "string" || itemDescription === undefined) &&
                (typeof group === "string" || group === undefined) &&
                (typeof location === "string" || location === undefined) &&
                (typeof count === "number") &&
                (typeof pointsToRedeem === "number");

            if (!isValid) {
                errors.push({ index, error: "Invalid barcode input types." });
                continue;
            }

            const newBarcode = {
                id: Utilities.generateUniqueID(),
                barcode: barcode.trim(),
                itemName: itemName.trim(),
                itemDescription: itemDescription?.trim() || "",
                group: group?.trim() || "consumable",
                location: location?.trim() || "",
                totalCount: count,
                pointsToRedeem,
                imageUrl: "",
                createdAt: now,
                updatedAt: now,
                updatedBy
            };

            DM["Barcodes"][newBarcode.id] = newBarcode;
            successes.push(newBarcode);
        }

        await DM.save();
        io.emit("barcodes_updated", Object.values(DM["Barcodes"] || {}));

        res.status(200).json({
            message: `SUCCESS: ${successes.length} barcodes saved.`,
            successes,
            errors
        });
    } catch (error) {
        console.error(`\n[API] - FAILED: /api/barcodes POST - ${error.stack || error}\n`);
        res.status(500).json({ error: "ERROR: Failed to save data." });
    }
});

// PUT endpoint: Update barcode item
app.put("/api/barcodes", securityMiddleware, async (req, res) => {
    console.log(`\n[API] - PUT: /api/barcodes\n`);
    try {
        const updates = Array.isArray(req.body) ? req.body : [req.body];
        const now = new Date().toISOString();
        const updatedBy = req?.user?.name || req?.user?.email || req?.user?.uid || "Unknown";

        const successes = [];
        const errors = [];

        for (const [index, item] of updates.entries()) {
            const { id, barcode, itemName, itemDescription, count, group, location, pointsToRedeem, operation = "edit", imageUrl } = item;

            const existingBarcode = DM.peek(["Barcodes", id]);

            if (!existingBarcode) {
                errors.push({ index, error: "Barcode not found", id });
                continue;
            }

            const currentGroup = (group || existingBarcode.group || "consumable").trim();
            let newCount = existingBarcode.totalCount;

            if (operation === "receive") {
                if (typeof count !== "number") {
                    errors.push({ index, error: "Count must be numeric", id });
                    continue;
                }
                newCount += count;
            } else if (operation === "dispatch") {
                if (typeof count !== "number" || count > existingBarcode.totalCount) {
                    errors.push({ index, error: "Invalid dispatch quantity", id });
                    continue;
                }

                newCount -= count;

                console.log(newCount);

                if (currentGroup === "consumable" && newCount <= 0) {
                    DM.destroy(["Barcodes", id]);
                    continue;
                }
            } else {
                if (typeof count === "number") newCount = count;
            }

            if (imageUrl) {
                const existingImageUrl = existingBarcode.imageUrl;

                if (existingImageUrl) {
                    const filePath = existingImageUrl.split("/").pop();

                    const { error: deleteError } = await supabase.storage
                        .from("filmmanager")
                        .remove([filePath]);

                    if (deleteError) {
                        errors.push({ index, error: "Failed to delete old image", id });
                        continue;
                    }
                }

                existingBarcode.imageUrl = imageUrl;
            }

            const updated = {
                ...existingBarcode,
                barcode: barcode?.trim() || existingBarcode.barcode,
                itemName: itemName?.trim() || existingBarcode.itemName,
                itemDescription: itemDescription?.trim() || existingBarcode.itemDescription,
                group: currentGroup,
                location: location?.trim() || existingBarcode.location,
                pointsToRedeem: typeof pointsToRedeem === "number" ? pointsToRedeem : existingBarcode.pointsToRedeem,
                totalCount: newCount,
                updatedAt: now,
                updatedBy
            };

            DM["Barcodes"][id] = updated;
            successes.push(updated);
        }

        await DM.save();
        io.emit("barcodes_updated", Object.values(DM["Barcodes"] || {}));

        res.status(200).json({
            message: `SUCCESS: ${successes.length} barcodes updated.`,
            successes,
            errors
        });
    } catch (error) {
        console.error(`\n[API] - FAILED: /api/barcodes PUT - ${error.stack || error}\n`);
        res.status(500).json({ error: "ERROR: Failed to update barcodes." });
    }
});

app.delete("/api/barcodes", authMiddleware, securityMiddleware, async (req, res) => {
    try {
        const ids = Array.isArray(req.body) ? req.body : [req.body?.id];
        const successes = [];
        const errors = [];

        for (const [index, id] of ids.entries()) {
            if (typeof id !== "string" || !id.trim()) {
                errors.push({ index, id, error: "Invalid or missing ID." });
                continue;
            }

            const existing = DM.peek(["Barcodes", id]);
            if (!existing) {
                errors.push({ index, id, error: "Barcode not found." });
                continue;
            }

            const imageUrl = existing.imageUrl;
            if (imageUrl && typeof imageUrl === "string") {
                const filePath = imageUrl.split("/").pop();

                if (filePath) {
                    const { error: deleteError } = await supabase.storage
                        .from("filmmanager")
                        .remove([filePath]);

                    if (deleteError) {
                        errors.push({ index, id, error: "Failed to delete image", imageUrl });
                        continue;
                    }
                } else {
                    console.log(`No file path found in image URL for barcode ${id}. Skipping image deletion.`);
                }
            } else {
                console.log(`No valid image URL found for barcode ${id}. Skipping image deletion.`);
            }

            DM.destroy(["Barcodes", id]);
            successes.push({ id, message: "Deleted successfully." });
        }

        await DM.save();
        io.emit("barcodes_updated", Object.values(DM["Barcodes"] || {}));

        res.status(200).json({
            message: `SUCCESS: ${successes.length} barcode(s) deleted.`,
            successes,
            errors
        });
    } catch (error) {
        console.error(`\n[API] - FAILED: /api/barcodes DELETE - ${error.stack || error}\n`);
        res.status(500).json({ error: "ERROR: Failed to delete barcodes." });
    }
});

// POST endpoint: Upload an image
app.post("/api/image/upload", async (req, res) => {
    try {
        const { itemId, base64, mimeType } = req.body;

        if (!itemId || !base64 || !mimeType) {
            return res.status(400).json({ error: "Missing required fields." });
        }

        const buffer = Buffer.from(base64, "base64");
        const uniqueFileName = Utilities.generateUniqueID();
        const filePath = `${uniqueFileName}`;

        const { data, error } = await supabase.storage
            .from("filmmanager")
            .upload(filePath, buffer, {
                contentType: mimeType,
                upsert: true,
            });

        if (error) throw error;

        const { data: publicData } = supabase.storage
        .from("filmmanager")
        .getPublicUrl(filePath);

        const imageUrl = publicData?.publicUrl;

        console.log(imageUrl)

        res.status(200).json({ filePath, imageUrl: imageUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// GET endpoint: Retrieve image URL using itemId
app.get("/api/image/url/:id", async (req, res) => {
    try {
        const { id } = req.params;

        if (!id) return res.status(400).json({ error: "Missing item id." });

        const filePath = `${id}`;

        const { data } = await supabase.storage
            .from("filmmanager")
            .getPublicUrl(filePath);

        return res.status(200).json({ url: data.publicUrl });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete("/api/image/delete/:filePath", async (req, res) => {
    try {
        const { filePath } = req.params;

        const { data, error } = await supabase.storage
            .from("filmmanager")
            .remove([filePath]);

        if (error) throw error;

        res.status(200).json({ message: "Image deleted", data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

io.on("connection", (socket) => {
    try {
        console.log(`\n[WEBSOCKET] - New client connected: ${socket.id}\n`);

        const barcodes = DM.peek(["Barcodes"]);

        const barcodeList = barcodes && typeof barcodes === "object" ? Object.values(barcodes) : [];

        socket.emit("barcodes_updated", barcodeList);
    } catch (error) {
        console.log(`\n[WEBSOCKET] - FAILED: Socket connection error - ${error.stack || error}\n`);
    }
});

io.on("disconnect", (socket) => {
    try {
        console.log(`\n[WEBSOCKET] - Client disconnected: ${socket.id}\n`);
    } catch (error) {
        console.log(`\n[WEBSOCKET] - FAILED: Socket disconnection error - ${error.stack || error}\n`);
    }
});

async function startServer() {
    try {
        await DM.load();
        console.log(`\n[DATABASEMANAGER] - SUCCESS: Data loaded from Firebase RTDB.\n`);

        httpServer.listen(port, "0.0.0.0", () => {
            console.log(`\nServer is running on http://localhost:${port}\n`);
        });
    } catch (error) {
        console.log(`\n[DATABASEMANAGER] - FAILED: ${error}\n`);
        process.exit(1);
    }
}

startServer();