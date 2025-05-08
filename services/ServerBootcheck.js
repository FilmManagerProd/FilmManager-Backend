const path = require("path");
const dotenv = require("dotenv");
const fs = require("fs");

// const envPath = path.resolve(__dirname, "../.env");

// if (!fs.existsSync(envPath)) {
//     console.log(`\n[BOOTCHECK] - FAILED: File not found; ${envPath}\n`);
//     process.exit(1);
// }

// const envResult = dotenv.config({ path: envPath });

// if (envResult.error) {
//     console.log(`\n[BOOTCHECK] - FAILED: Couldn't load ${envPath}: ${envResult.error}\n`);
//     process.exit(1);
// }

const saKeyPath = "/etc/secrets/serviceAccountKey.json";

if (!fs.existsSync(saKeyPath)) {
    console.log(`\n[BOOTCHECK] - FAILED: Service Account Key missing: ${saKeyPath}\n`);
    process.exit(1);
}

let serviceAccount;

try {
    serviceAccount = JSON.parse(fs.readFileSync(saKeyPath, "utf8"));
} catch (error) {
    console.log(`\n[BOOTCHECK] - FAILED: Service Account Key is not valid JSON: ${error}\n`);
    process.exit(1);
}

const requiredSAKeys = [
    'type',
    'project_id',
    'private_key_id',
    'private_key',
    'client_email',
    'client_id',
    'auth_uri',
    'token_uri',
    'auth_provider_x509_cert_url',
    'client_x509_cert_url',
    'universe_domain'
];

const missingSAKeys = requiredSAKeys.filter(key => !(key in serviceAccount));

if (missingSAKeys.length > 0) {
    console.log(`\n[BOOTCHECK] - FAILED: Service Account Key missing required keys: ${missingSAKeys.join(", ")}\n`);
    process.exit(1);
}

const requiredEnvVars = [
    'PORT',
    'API_KEY',
    'FIREBASE_DATABASE_URL',
    'SUPABASE_URL',
    'SUPABASE_ANON_KEY'
];

const missingEnvVars = requiredEnvVars.filter(varName => !process.env[varName]);

if (missingEnvVars.length > 0) {
    console.log(`\n[BOOTCHECK] - FAILED: Environment variables missing: ${missingEnvVars.join(", ")}\n`);
    process.exit(1);
}

let admin;

try {
    admin = require("firebase-admin");
} catch (error) {
    console.log(`\n[BOOTCHECK] - FAILED: firebase-admin module not found. Please install it.\n`);
    process.exit(1);
}

(async () => {
    try {
        const credential = admin.credential.cert(serviceAccount);

        const tokenResponse = await credential.getAccessToken();

        if (!tokenResponse || !tokenResponse.access_token) {
            console.log(`\n[BOOTCHECK] - FAILED: Unable to generate a valid access token using the Service Account Key.\n`);
            process.exit(1);
        }

        admin.initializeApp({
            credential: credential
        });

        const firestore = admin.firestore();
        await firestore.collection('dummy').limit(1).get();

        console.log(`\n[BOOTCHECK] - SUCCESS: All environment variables and Service Account Key audited. SYSTEM READY.\n`);
        process.exit(0);
    } catch (error) {
        console.log(`\n[BOOTCHECK] - FAILED: Firebase connection test failed: ${error}\n`);
        process.exit(1);
    }
})();